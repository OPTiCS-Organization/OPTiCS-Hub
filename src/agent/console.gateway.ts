import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AgentGateway } from './agent.gateway';
import log from 'spectra-log';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma.service';
import { JwtUtil } from 'src/auth/util/jwt.util';
import { TokenPurpose } from 'src/auth/types/TokenPurpose.type';
import { randomUUID } from 'crypto';

type TerminalSession = {
  consoleSocketId: string;
  agentUuid: string;
};

type MetricRequest = TerminalSession & {
  timer: NodeJS.Timeout;
};

@Injectable()
/** CORS·Origin 검증은 OriginCheckingIoAdapter가 서버 단위로 처리한다. */
@WebSocketGateway({ namespace: '/console' })
export class ConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => AgentGateway))
    private readonly agentGateway: AgentGateway,
    private readonly jwtService: JwtService,
    private readonly jwtUtil: JwtUtil,
    private readonly prismaService: PrismaService,
  ) {}

  private readonly terminalSessions = new Map<string, TerminalSession>();
  private readonly metricRequests = new Map<string, MetricRequest>();
  private readonly consumedTerminalTokens = new Set<string>();

  /** 모든 Console 클라이언트에 Agent 정보 갱신을 알린다. */
  notifyAgentUpdated() {
    this.server.emit('agent-updated');
  }

  /** 특정 워크스페이스의 Console 클라이언트에 Agent 정보 갱신을 알린다. */
  notifyWorkspaceUpdated(workspaceIndex: number | null) {
    if (!workspaceIndex) {
      this.notifyAgentUpdated();
      return;
    }
    this.emitToWorkspace(workspaceIndex, 'agent-updated');
  }

  /** Console 소켓 연결 시 쿠키의 JWT를 검증하고 사용자 식별자를 저장한다. */
  async handleConnection(client: Socket) {
    const accessToken = this.readCookie(client.handshake.headers.cookie, 'accessToken');
    if (!accessToken) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ userIndex: number }>(accessToken);
      client.data.userIndex = payload.userIndex;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [sessionId, session] of this.terminalSessions) {
      if (session.consoleSocketId !== client.id) continue;
      this.agentGateway.sendToAgent(session.agentUuid, 'terminal-close', { sessionId });
      this.terminalSessions.delete(sessionId);
    }

    for (const [requestId, request] of this.metricRequests) {
      if (request.consoleSocketId !== client.id) continue;
      clearTimeout(request.timer);
      this.metricRequests.delete(requestId);
    }
  }

  /** Cookie 헤더에서 지정한 이름의 값을 찾아 디코딩한다. */
  private readCookie(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
    const target = cookies.find(cookie => cookie.startsWith(`${name}=`));
    return target ? decodeURIComponent(target.slice(name.length + 1)) : null;
  }

  /** 워크스페이스별 Socket.IO 룸 이름을 생성한다. */
  private workspaceRoom(workspaceIndex: number): string {
    return `workspace:${workspaceIndex}`;
  }

  /** 연결된 사용자가 해당 워크스페이스의 소유자인지 확인한다. */
  private async canAccessWorkspace(client: Socket, workspaceIndex: number): Promise<boolean> {
    const userIndex = client.data.userIndex as number | undefined;
    if (!userIndex || !Number.isFinite(workspaceIndex)) return false;
    const workspace = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_index: workspaceIndex,
        workspace_owner: userIndex,
        workspace_deleted_at: null,
      },
      select: { workspace_index: true },
    });
    return Boolean(workspace);
  }

  /** 연결된 사용자가 링크된 Agent에 접근할 권한이 있는지 확인한다. */
  private async canAccessAgent(client: Socket, agentUuid: string, workspaceIndex?: number): Promise<boolean> {
    const userIndex = client.data.userIndex as number | undefined;
    if (!userIndex || !agentUuid) return false;
    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_uuid: agentUuid,
        agent_connection: 'linked',
        agent_deleted_at: null,
        parent: {
          workspace_owner: userIndex,
          workspace_deleted_at: null,
          ...(workspaceIndex ? { workspace_index: workspaceIndex } : {}),
        },
      },
      select: { agent_index: true },
    });
    return Boolean(agent);
  }

  /** 서비스가 사용자의 워크스페이스와 지정한 Agent에 속하는지 확인한다. */
  private async canAccessService(
    client: Socket,
    workspaceIndex: number,
    agentUuid: string,
    serviceIndex: number,
  ): Promise<boolean> {
    const userIndex = client.data.userIndex as number | undefined;
    if (!userIndex || !Number.isFinite(workspaceIndex) || !Number.isFinite(serviceIndex) || !agentUuid) {
      return false;
    }

    const service = await this.prismaService.services.findFirst({
      where: {
        service_index: serviceIndex,
        service_parent_workspace: workspaceIndex,
        service_deleted_at: null,
        workspace: {
          workspace_index: workspaceIndex,
          workspace_owner: userIndex,
          workspace_deleted_at: null,
        },
        agent: {
          agent_uuid: agentUuid,
          agent_connection: 'linked',
          agent_deleted_at: null,
        },
      },
      select: { service_index: true },
    });
    return Boolean(service);
  }

  /** 워크스페이스 룸에 참여시키고 연결된 Agent의 컨테이너 상태 동기화를 요청한다. */
  @SubscribeMessage('subscribe-workspace')
  async handleSubscribeWorkspace(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { workspaceIndex: number },
  ) {
    const workspaceIndex = Number(payload.workspaceIndex);
    if (!(await this.canAccessWorkspace(client, workspaceIndex))) return;
    await client.join(this.workspaceRoom(workspaceIndex));
    const agents = await this.prismaService.agents.findMany({
      where: {
        agent_parent_workspace: workspaceIndex,
        agent_connection: 'linked',
        agent_deleted_at: null,
      },
      select: { agent_uuid: true },
    });
    for (const agent of agents) {
      this.agentGateway.sendToAgent(agent.agent_uuid, 'command', {
        command: 'GET_CONTAINER_STATUS',
      });
    }
  }

  /** 지정한 워크스페이스 룸에 Console 이벤트를 전송한다. */
  emitToWorkspace(workspaceIndex: number, event: 'agent-updated' | 'service-status' | 'service-log' | 'service-log-history' | 'service-log-markers' | 'log-load-progress' | 'container-status' | 'response', payload?: object) {
    this.server.to(this.workspaceRoom(workspaceIndex)).emit(event, payload);
  }

  /** Agent 접근 권한을 확인한 뒤 Console 명령을 해당 Agent로 전달한다. */
  @SubscribeMessage('command')
  async handleCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { agentUuid: string; [key: string]: unknown },
  ) {
    const { agentUuid, ...rest } = payload;
    if (!(await this.canAccessAgent(client, agentUuid))) return;
    this.agentGateway.sendToAgent(agentUuid, 'command', rest);
  }

  /** 서비스 접근 권한을 확인하고 실시간 로그 스트리밍을 시작한다. */
  @SubscribeMessage('subscribe-log')
  async handleSubscribeLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { workspaceIndex: number; agentUuid: string; serviceIndex: number; serviceName: string; deployPreset: string },
  ) {
    const workspaceIndex = Number(payload.workspaceIndex);
    if (!(await this.canAccessService(client, workspaceIndex, payload.agentUuid, Number(payload.serviceIndex)))) return;
    await client.join(this.workspaceRoom(workspaceIndex));
    log(`[{{ yellow : bold : Console Gateway }}] subscribe-log | agent=${payload.agentUuid} | serviceIndex=${payload.serviceIndex} | name=${payload.serviceName}`);
    this.agentGateway.sendToAgent(payload.agentUuid, 'command', {
      command: 'STREAM_LOG',
      serviceIndex: payload.serviceIndex,
      serviceName: payload.serviceName,
      deployPreset: payload.deployPreset,
    });
  }

  /** Agent 접근 권한을 확인하고 실행 중인 로그 스트리밍을 중지한다. */
  @SubscribeMessage('unsubscribe-log')
  async handleUnsubscribeLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { workspaceIndex: number; agentUuid: string; serviceName: string },
  ) {
    if (!(await this.canAccessAgent(client, payload.agentUuid, Number(payload.workspaceIndex)))) return;
    log(`[{{ yellow : bold : Console Gateway }}] unsubscribe-log | agent=${payload.agentUuid} | name=${payload.serviceName}`);
    this.agentGateway.sendToAgent(payload.agentUuid, 'command', {
      command: 'STOP_LOG',
      serviceName: payload.serviceName,
    });
  }

  @SubscribeMessage('agent-metrics-request')
  async handleAgentMetricsRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { agentUuid: string },
  ) {
    if (!(await this.canAccessAgent(client, payload.agentUuid))) {
      return { ok: false, error: 'Agent access denied.' };
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => this.metricRequests.delete(requestId), 5000);
    this.metricRequests.set(requestId, {
      consoleSocketId: client.id,
      agentUuid: payload.agentUuid,
      timer,
    });

    if (!this.agentGateway.sendToAgent(payload.agentUuid, 'system-metrics-request', { requestId })) {
      clearTimeout(timer);
      this.metricRequests.delete(requestId);
      return { ok: false, error: 'Agent is offline.' };
    }

    return { ok: true };
  }

  @SubscribeMessage('terminal-open')
  async handleTerminalOpen(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { token: string; cols?: number; rows?: number },
  ) {
    try {
      const token = await this.jwtUtil.verifyPurposeToken(payload.token, TokenPurpose.TERMINAL_SSH);
      const userIndex = Number(token.sub);
      const socketUserIndex = client.data.userIndex as number | undefined;

      if (!token.jti || this.consumedTerminalTokens.has(token.jti)) {
        return { ok: false, error: 'Terminal token was already used.' };
      }
      if (!token.agentUuid || userIndex !== socketUserIndex) {
        return { ok: false, error: 'Terminal token does not match this session.' };
      }
      if (!(await this.canAccessAgent(client, token.agentUuid))) {
        return { ok: false, error: 'Agent access denied.' };
      }

      const sessionId = randomUUID();
      this.consumedTerminalTokens.add(token.jti);
      const tokenLifetimeMs = Math.max(1000, ((token.exp ?? Math.floor(Date.now() / 1000) + 60) * 1000) - Date.now());
      setTimeout(() => this.consumedTerminalTokens.delete(token.jti), tokenLifetimeMs);
      this.terminalSessions.set(sessionId, {
        consoleSocketId: client.id,
        agentUuid: token.agentUuid,
      });

      const sent = this.agentGateway.sendToAgent(token.agentUuid, 'terminal-open', {
        sessionId,
        cols: clampDimension(payload.cols, 80),
        rows: clampDimension(payload.rows, 24),
      });
      if (!sent) {
        this.terminalSessions.delete(sessionId);
        return { ok: false, error: 'Agent is offline.' };
      }

      return { ok: true, sessionId };
    } catch {
      return { ok: false, error: 'Terminal authorization failed.' };
    }
  }

  @SubscribeMessage('terminal-input')
  handleTerminalInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; data: string },
  ) {
    const session = this.ownedTerminalSession(client, payload.sessionId);
    if (!session || typeof payload.data !== 'string' || Buffer.byteLength(payload.data) > 64 * 1024) return;
    this.agentGateway.sendToAgent(session.agentUuid, 'terminal-input', payload);
  }

  @SubscribeMessage('terminal-resize')
  handleTerminalResize(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string; cols?: number; rows?: number },
  ) {
    const session = this.ownedTerminalSession(client, payload.sessionId);
    if (!session) return;
    this.agentGateway.sendToAgent(session.agentUuid, 'terminal-resize', {
      sessionId: payload.sessionId,
      cols: clampDimension(payload.cols, 80),
      rows: clampDimension(payload.rows, 24),
    });
  }

  @SubscribeMessage('terminal-close')
  handleTerminalClose(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    const session = this.ownedTerminalSession(client, payload.sessionId);
    if (!session) return;
    this.agentGateway.sendToAgent(session.agentUuid, 'terminal-close', payload);
    this.terminalSessions.delete(payload.sessionId);
  }

  forwardSystemMetrics(agentUuid: string, payload: { requestId: string; metrics: unknown }) {
    const request = this.metricRequests.get(payload.requestId);
    if (!request || request.agentUuid !== agentUuid) return;
    clearTimeout(request.timer);
    this.metricRequests.delete(payload.requestId);
    this.server.to(request.consoleSocketId).emit('agent-metrics', {
      agentUuid,
      metrics: payload.metrics,
    });
  }

  forwardTerminalReady(agentUuid: string, payload: { sessionId: string }) {
    const session = this.agentTerminalSession(agentUuid, payload.sessionId);
    if (!session) return;
    this.server.to(session.consoleSocketId).emit('terminal-ready', payload);
  }

  forwardTerminalOutput(agentUuid: string, payload: { sessionId: string; data: string }) {
    const session = this.agentTerminalSession(agentUuid, payload.sessionId);
    if (!session || typeof payload.data !== 'string') return;
    this.server.to(session.consoleSocketId).emit('terminal-output', payload);
  }

  forwardTerminalClosed(agentUuid: string, payload: { sessionId: string; reason?: string }) {
    const session = this.agentTerminalSession(agentUuid, payload.sessionId);
    if (!session) return;
    this.terminalSessions.delete(payload.sessionId);
    this.server.to(session.consoleSocketId).emit('terminal-closed', payload);
  }

  closeAgentConnections(agentUuid: string) {
    for (const [sessionId, session] of this.terminalSessions) {
      if (session.agentUuid !== agentUuid) continue;
      this.terminalSessions.delete(sessionId);
      this.server.to(session.consoleSocketId).emit('terminal-closed', {
        sessionId,
        reason: 'Agent disconnected.',
      });
    }

    for (const [requestId, request] of this.metricRequests) {
      if (request.agentUuid !== agentUuid) continue;
      clearTimeout(request.timer);
      this.metricRequests.delete(requestId);
    }
  }

  private ownedTerminalSession(client: Socket, sessionId: string) {
    const session = this.terminalSessions.get(sessionId);
    return session?.consoleSocketId === client.id ? session : null;
  }

  private agentTerminalSession(agentUuid: string, sessionId: string) {
    const session = this.terminalSessions.get(sessionId);
    return session?.agentUuid === agentUuid ? session : null;
  }
}

function clampDimension(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(500, Math.max(1, Math.floor(value)));
}
