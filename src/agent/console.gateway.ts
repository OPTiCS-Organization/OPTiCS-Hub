import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
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

@Injectable()
@WebSocketGateway({ namespace: '/console', cors: { origin: true, credentials: true } })
export class ConsoleGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => AgentGateway))
    private readonly agentGateway: AgentGateway,
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
  ) {}

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
}
