import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Namespace, Server, Socket } from 'socket.io';
import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ConsoleGateway } from './console.gateway';
import { AgentUpdateService } from './agent-update.service';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { ServiceComponentStatus } from '@prisma/client';
import { ReplayGuard, sign, verify } from 'src/global/hash.util';
import { PROTOCOL_RESULT_CODE } from './types/ResultCode.type';

const MINIMUM_PROTOCOL_VERSION = 1;
const MAXIMUM_PROTOCOL_VERSION = 1;

/** 서명 검증을 건너뛰는 이벤트. register는 소켓에 비밀이 붙기 전이라 따로 검증한다. */
const UNVERIFIED_EVENTS = new Set(['register']);

type ServiceLogPayload = {
  serviceIndex: number;
  log: string;
  timestamp?: string;
  source?: 'hub' | 'agent' | 'runtime';
  stream?: 'deploy' | 'lifecycle' | 'runtime';
  containerName?: string;
  composeService?: string;
  stderr?: boolean;
};

@Injectable()
@WebSocketGateway({ namespace: '/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly agentUuidToSocketId = new Map<string, string>();
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private readonly agentService: AgentService,
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConsoleGateway))
    private readonly consoleGateway: ConsoleGateway,
    @Inject(forwardRef(() => AgentUpdateService))
    private readonly agentUpdateService: AgentUpdateService,
  ) { }

  private async getWorkspaceIndexForAgentService(agentUuid: string, serviceIndex: number): Promise<number | null> {
    const service = await this.prismaService.services.findFirst({
      where: { service_index: serviceIndex, service_deleted_at: null },
      select: { service_parent_agent: true, service_parent_workspace: true },
    });
    if (!service) return null;

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: service.service_parent_agent,
        agent_uuid: agentUuid,
        agent_connection: 'linked',
        agent_deleted_at: null,
      },
      select: { agent_index: true },
    });
    if (!agent) return null;

    return service.service_parent_workspace;
  }

  private normalizeComponentStatus(status: string): ServiceComponentStatus {
    const validStatuses: ServiceComponentStatus[] = ['waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed', 'restarting'];
    return validStatuses.includes(status as ServiceComponentStatus)
      ? status as ServiceComponentStatus
      : 'stopped';
  }

  private async syncServiceComponents(
    serviceIndex: number,
    containers: { name: string; status: string; service?: string; exitCode?: number | null; health?: string | null }[],
  ) {
    const service = await this.prismaService.services.findFirst({
      where: { service_index: serviceIndex, service_deleted_at: null },
      select: { service_name: true, service_deploy_preset: true },
    });
    if (!service) return;

    const seenNames = new Set<string>();
    for (const container of containers) {
      const componentName = container.service?.trim()
        || (service.service_deploy_preset === 'compose' ? container.name : 'app');
      if (!componentName) continue;
      seenNames.add(componentName);

      await this.prismaService.service_components.upsert({
        where: {
          component_parent_service_component_name: {
            component_parent_service: serviceIndex,
            component_name: componentName,
          },
        },
        create: {
          component_parent_service: serviceIndex,
          component_name: componentName,
          component_container_name: container.name,
          component_status: this.normalizeComponentStatus(container.status),
          component_health: container.health ?? null,
          component_exit_code: container.exitCode ?? null,
        },
        update: {
          component_container_name: container.name,
          component_status: this.normalizeComponentStatus(container.status),
          component_health: container.health ?? null,
          component_exit_code: container.exitCode ?? null,
          component_deleted_at: null,
        },
      });
    }

    if (containers.length === 0) {
      await this.prismaService.service_components.updateMany({
        where: { component_parent_service: serviceIndex, component_deleted_at: null },
        data: { component_status: 'removed' },
      });
      return;
    }

    await this.prismaService.service_components.updateMany({
      where: {
        component_parent_service: serviceIndex,
        component_deleted_at: null,
        component_name: { notIn: [...seenNames] },
      },
      data: { component_status: 'removed' },
    });
  }

  @SubscribeMessage('response')
  handleResponse(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const workspaceIndex = client.data.workspaceIndex as number | null | undefined;
    if (!workspaceIndex) return;
    this.consoleGateway.emitToWorkspace(workspaceIndex, 'response', payload as object);
  }

  @SubscribeMessage('system-metrics')
  handleSystemMetrics(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { requestId: string; metrics: unknown },
  ) {
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    this.consoleGateway.forwardSystemMetrics(agentUuid, payload);
  }

  @SubscribeMessage('terminal-ready')
  handleTerminalReady(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    this.consoleGateway.forwardTerminalReady(agentUuid, payload);
  }

  @SubscribeMessage('terminal-output')
  handleTerminalOutput(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; data: string },
  ) {
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    this.consoleGateway.forwardTerminalOutput(agentUuid, payload);
  }

  @SubscribeMessage('terminal-closed')
  handleTerminalClosed(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; reason?: string },
  ) {
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    this.consoleGateway.forwardTerminalClosed(agentUuid, payload);
  }

  @SubscribeMessage('container-status')
  async handleContainerStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      serviceIndex: number;
      containers: { name: string; status: string; service?: string; exitCode?: number | null; health?: string | null }[];
      counts?: { running: number; total: number };
    },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (!workspaceIndex) return;
    await this.syncServiceComponents(payload.serviceIndex, payload.containers).catch((error: unknown) => {
      log(`[Agent Gateway] Failed to sync service components | serviceIndex=${payload.serviceIndex} | ${String(error)}`, 500, 'ERROR');
    });
    this.consoleGateway.emitToWorkspace(workspaceIndex, 'container-status', { agentCode, ...payload });
  }

  @SubscribeMessage('service-status')
  async handleServiceStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { serviceIndex: number; status: string },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (!workspaceIndex) return;

    const dbStatuses = ['waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed'];
    if (dbStatuses.includes(payload.status)) {
      await this.agentService.updateServiceStatus(payload.serviceIndex, payload.status).catch((error: unknown) => {
        log(`[Agent Gateway] Failed to update service status | serviceIndex=${payload.serviceIndex} | status=${payload.status} | ${String(error)}`, 500, 'ERROR');
      });
    }
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-status', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log')
  async handleServiceLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ServiceLogPayload,
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('log-load-progress')
  async handleLogLoadProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { serviceIndex: number; loaded: number; total: number; percent: number; phase: string },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'log-load-progress', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log-history')
  async handleServiceLogHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      serviceIndex: number;
      logs: {
        line: string;
        timestamp?: string;
        source?: 'hub' | 'agent' | 'runtime';
        stream?: 'deploy' | 'lifecycle' | 'runtime';
        containerName?: string;
        composeService?: string;
        stderr?: boolean;
      }[];
      markers?: { serviceIndex: number; serviceName: string; containerName: string; event: string; timestamp: string }[];
      before?: string;
      hasMore?: boolean;
    },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log-history', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log-markers')
  async handleServiceLogMarkers(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      serviceIndex: number;
      markers: { serviceIndex: number; serviceName: string; containerName: string; event: string; timestamp: string }[];
    },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log-markers', { agentCode, ...payload });
    }
  }

  /**
   * 연결 수락 시 일단 IP부터 저장,
   * Agent가 Validation 이벤트 emit할 때까지 대기
   * @param client
   */
  async handleConnection() {
    log('[Agent Gateway] Connection Established', 200, 'INFO')
  }

  @SubscribeMessage('update-log')
  async handleUpdateLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { line: string },
  ) {
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid || typeof payload?.line !== 'string') return;
    await this.agentUpdateService.recordProgress(agentUuid, payload.line);
  }

  @SubscribeMessage('update-failed')
  async handleUpdateFailed(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { message: string },
  ) {
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    await this.agentUpdateService.recordFailure(agentUuid, String(payload?.message ?? '').slice(0, 500));
  }

  @SubscribeMessage('register')
  async handleValidation(client: Socket, payload: { agentUuid: string | null; agentVersion: string; protocolVersion: number; _sig: string | null }) {
    // 프로토콜 버전이 존재하지 않으면 구버전, 최소 지원 버전보다 낮으면 연결 거부
    if (!payload.protocolVersion || payload.protocolVersion < MINIMUM_PROTOCOL_VERSION || payload.protocolVersion > MAXIMUM_PROTOCOL_VERSION) {
      /**
       * "너무 낡음"과 "Hub가 모르는 버전"을 구분해서 알려준다.
       *
       * 둘 다 접속 실패지만 운영자가 해야 할 일이 정반대다. 전자는 Agent를 올려야 하고,
       * 후자는 Agent가 Hub보다 앞서 있다는 뜻이라 Hub를 올려야 한다.
       */
      const code = payload.protocolVersion > MAXIMUM_PROTOCOL_VERSION
        ? PROTOCOL_RESULT_CODE.UNKNOWN_PROTOCOL_VERSION
        : PROTOCOL_RESULT_CODE.DEPRECATED_PROTOCOL_VERSION;

      log(`[Agent Gateway] Disconnecting agent ${payload.agentUuid}: Unsupported protocol version(v${payload.protocolVersion}).`);
      client.emit('register', { code, data: { minimum: MINIMUM_PROTOCOL_VERSION, maximum: MAXIMUM_PROTOCOL_VERSION } });
      client.disconnect(true);
      return;
    }

    log(`[Agent Gateway] Validating agent: ${payload.agentUuid}`, 200, 'INFO')

    /**
     * 자신이 기존 Agent라고 주장하면 그 주장을 서명으로 증명하게 한다.
     *
     * UUID는 페이로드에 실려 오는 값이라 그것만 보고 등록하면, UUID를 아는 누구든
     * 남의 Agent로 접속해 그 워크스페이스의 명령을 대신 받을 수 있다.
     * 비밀이 아직 없는 Agent는 증명할 수단이 없으므로 통과시키고, registerAgent가
     * 이번 등록에서 비밀을 발급해 다음 접속부터 증명할 수 있게 만든다.
     */
    if (payload.agentUuid) {
      const knownSecret = await this.agentService.getSigningSecret(payload.agentUuid);
      if (knownSecret) {
        const verification = verify('register', payload, knownSecret);
        if (!verification.ok) {
          log(`[Agent Gateway] {{ red : bold : SIGNATURE:REJECTED }}\n  event: register\n  agent: ${payload.agentUuid}\n  reason: ${verification.reason}`, 401, 'ERROR');
          client.emit('register', { code: PROTOCOL_RESULT_CODE.INVALID_SIGNATURE, data: { reason: verification.reason } });
          client.disconnect(true);
          return;
        }
      }
    }

    const rawIp = (client.handshake.headers['x-forwarded-for'] as string) ?? client.handshake.address;
    const ip = rawIp === '::1' ? '127.0.0.1' : rawIp.replace(/^::ffff:/, '');

    // 에이전트를 등록한다.
    const agent = await this.agentService.registerAgent(ip, payload.agentUuid, payload.agentVersion, payload.protocolVersion, payload._sig);
    log(`[Agent Gateway] Agent registation finished.`);

    this.clearOfflineTimer(agent.uuid);
    this.agentUuidToSocketId.set(agent.uuid, client.id);
    client.data.agentCode = agent.code;
    client.data.agentUuid = agent.uuid;
    client.data.agentIp = agent.ip;
    client.data.workspaceIndex = agent.parentWorkspace;

    /**
     * 이후 이벤트를 검증할 비밀을 소켓에 붙인다.
     *
     * `agent.signingSecret`을 그대로 쓰면 안 된다. 그건 "이번에 발급해서 보내줄 값"이라
     * 이미 비밀을 가진 Agent에게는 null이고, 그러면 그 소켓의 모든 이벤트가
     * 검증 불가가 된다. 유효한 비밀을 다시 읽어와 붙인다.
     */
    client.data.signingSecret = agent.signingSecret ?? await this.agentService.getSigningSecret(agent.uuid);
    client.data.replayGuard = new ReplayGuard();
    this.guardIncomingPackets(client);

    client.emit('register', { code: PROTOCOL_RESULT_CODE.OK, data: agent });
    log(`[Agent Gateway] Registration information sent.`);
    // 업데이트 직후의 재접속이라면 보고된 버전으로 성공/롤백을 판정한다.
    await this.agentUpdateService.handleReconnect(agent.uuid, payload.agentVersion ?? null);
    this.consoleGateway.notifyWorkspaceUpdated(agent.parentWorkspace);
  }

  async handleDisconnect(client: Socket) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = (client.data.agentUuid as string | undefined) ?? (client.handshake.auth as { agentUuid?: string }).agentUuid;
    log(`[Agent Gateway] [Disconnected] ${agentUuid}`)
    if (agentCode && agentUuid) {
      if (this.agentUuidToSocketId.get(agentUuid) !== client.id) return;
      this.consoleGateway.closeAgentConnections(agentUuid);
      this.agentUuidToSocketId.delete(agentUuid);
      // 업데이트로 인한 재시작은 오프라인이 아니다. 매번 오프라인으로 깜빡이면 사고처럼 보인다.
      if (await this.agentUpdateService.isExpectedRestart(agentUuid)) return;
      this.scheduleOffline(agentUuid);
    }
  }

  /**
   * 등록된 소켓으로 들어오는 모든 이벤트를 한 곳에서 서명 검증한다.
   *
   * 핸들러마다 검증을 넣으면 언젠가 빠뜨리는 핸들러가 생기고, 공격자는 정확히
   * 그 하나만 찾으면 된다. socket.io의 소켓 단위 미들웨어는 그 소켓의 모든 수신
   * 패킷이 반드시 지나는 지점이라, 새 @SubscribeMessage가 추가돼도 자동으로 덮인다.
   *
   * 검증에 실패한 패킷은 next()를 부르지 않고 그대로 버린다. 에러로 넘기면
   * socket.io가 클라이언트에 error 이벤트를 돌려주는데, 위조 패킷을 보낸 쪽에
   * "무엇이 틀렸는지"를 알려줄 이유가 없다.
   *
   * 소켓을 끊지 않고 패킷만 버리는 이유는, 정상 Agent가 시계 밀림(EXPIRED)으로
   * 일시적으로 걸릴 수 있기 때문이다. 그때 연결을 끊으면 재연결 폭풍이 된다.
   * 신원 자체가 의심스러운 경우는 register에서 이미 끊었다.
   */
  private guardIncomingPackets(client: Socket) {
    // 같은 소켓에서 register가 두 번 오면 미들웨어가 중복 설치된다.
    if (client.data.packetGuardInstalled) return;
    client.data.packetGuardInstalled = true;

    client.use(([event, payload], next) => {
      if (UNVERIFIED_EVENTS.has(event)) return next();

      /**
       * 이 미들웨어는 register를 통과한 소켓에만 붙고, 그 시점에 비밀은 반드시 존재한다.
       * (registerAgent가 신규 발급하거나, 없으면 재발급한 뒤에야 여기까지 온다)
       * 그러므로 비밀이 비어 있다는 것은 등록 경로가 깨졌다는 뜻이고, 통과시킬 이유가 없다.
       */
      const secret = client.data.signingSecret as string | null | undefined;
      if (!secret) {
        log(`[Agent Gateway] {{ red : bold : SIGNATURE:NO_SECRET }}\n  event: ${event}\n  agent: ${client.data.agentUuid ?? '-'}\n  The socket passed registration without a signing secret.`, 500, 'ERROR');
        return;
      }

      const verification = verify(event, payload, secret, { replayGuard: client.data.replayGuard as ReplayGuard });
      if (verification.ok) return next();

      log(`[Agent Gateway] {{ red : bold : SIGNATURE:REJECTED }}\n  event: ${event}\n  agent: ${client.data.agentUuid ?? '-'}\n  reason: ${verification.reason}`, 401, 'ERROR');
    });
  }

  /**
   * Agent로 나가는 유일한 발신 통로. 페이로드에 서명을 붙인다.
   *
   * Agent도 Hub와 같은 이유로 이 서명을 요구한다. Agent 입장에서 `command`는
   * "이 코드를 받아 실행하라"는 지시이므로, 보낸 쪽이 정말 Hub인지 확인할 수단이
   * 없으면 소켓을 가로챈 쪽이 그대로 원격 실행 권한을 얻는다.
   *
   * 비밀은 소켓에 붙여둔 값을 쓴다. 방을 거치지 않고 소켓 객체를 직접 꺼내는 이유는
   * `server.to(socketId)`로는 그 소켓의 data에 접근할 수 없기 때문이다.
   */
  sendToAgent(agentUuid: string, event: string, payload: unknown): boolean {
    const socket = this.getAgentSocket(agentUuid);
    if (!socket) return false;

    const secret = socket.data.signingSecret as string | null | undefined;
    if (!secret) {
      log(`[Agent Gateway] {{ red : bold : SIGNATURE:NO_SECRET }}\n  event: ${event}\n  agent: ${agentUuid}\n  Outbound event was dropped: the socket has no signing secret.`, 500, 'ERROR');
      return false;
    }

    socket.emit(event, sign(event, payload, secret));
    return true;
  }

  /**
   * 등록된 Agent의 소켓 객체를 찾는다. 없으면 null.
   *
   * `@WebSocketServer()`는 namespace가 지정된 게이트웨이에 Server가 아니라 **Namespace**를
   * 주입한다. Namespace에서는 `.sockets`가 곧 `Map<socketId, Socket>`이라,
   * Server 기준으로 쓴 `this.server.sockets.sockets`는 런타임에 undefined가 된다.
   * 선언 타입이 Server라 타입 검사만으로는 드러나지 않으므로 여기서 좁혀 쓴다.
   */
  private getAgentSocket(agentUuid: string): Socket | null {
    const socketId = this.agentUuidToSocketId.get(agentUuid);
    if (!socketId) return null;

    const sockets = (this.server as unknown as Namespace).sockets;
    return sockets.get(socketId) ?? null;
  }

  disconnectAgent(agentUuid: string): boolean {
    const socket = this.getAgentSocket(agentUuid);
    if (!socket) return false;

    /**
     * DISCONNECT도 sendToAgent를 거친다.
     *
     * 예전에는 여기서 소켓에 직접 emit했는데, Agent가 서명을 요구하기 시작하면
     * 그 미서명 명령만 조용히 무시되어 "끊기 명령을 보냈는데 안 끊긴다"가 된다.
     */
    this.sendToAgent(agentUuid, 'command', { command: 'DISCONNECT' });
    setTimeout(() => socket.disconnect(true), 250);
    this.agentUuidToSocketId.delete(agentUuid);
    this.clearOfflineTimer(agentUuid);
    return true;
  }

  /** 소켓이 실제로 붙어 있는지. 업데이트 타임아웃 처리에서 오프라인 여부를 판단하는 데 쓴다. */
  isAgentConnected(agentUuid: string): boolean {
    return this.agentUuidToSocketId.has(agentUuid);
  }

  private scheduleOffline(agentUuid: string) {
    this.clearOfflineTimer(agentUuid);
    const timer = setTimeout(() => {
      this.offlineTimers.delete(agentUuid);
      if (this.agentUuidToSocketId.has(agentUuid)) return;
      void this.agentService.markAgentOffline(agentUuid);
    }, 3000);
    this.offlineTimers.set(agentUuid, timer);
  }

  private clearOfflineTimer(agentUuid: string) {
    const timer = this.offlineTimers.get(agentUuid);
    if (!timer) return;
    clearTimeout(timer);
    this.offlineTimers.delete(agentUuid);
  }
}
