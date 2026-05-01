import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ConsoleGateway } from './console.gateway';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';

@Injectable()
@WebSocketGateway({ namespace: '/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly agentUuidToSocketId = new Map<string, string>();
  constructor(
    private readonly agentService: AgentService,
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConsoleGateway))
    private readonly consoleGateway: ConsoleGateway,
  ) { }

  private async getWorkspaceIndexForAgentService(agentUuid: string, serviceIndex: number): Promise<number | null> {
    const service = await this.prismaService.services.findFirst({
      where: { service_index: serviceIndex, service_deleted_at: null },
      select: { service_parent_agent: true },
    });
    if (!service) return null;

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: service.service_parent_agent,
        agent_uuid: agentUuid,
        agent_connection: 'linked',
        agent_deleted_at: null,
      },
      select: { agent_parent_workspace: true },
    });
    if (!agent?.agent_parent_workspace) return null;

    return agent.agent_parent_workspace;
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

    const dbStatuses = ['waiting', 'building', 'running', 'stopped', 'failed', 'removed'];
    if (dbStatuses.includes(payload.status)) {
      await this.agentService.updateServiceStatus(payload.serviceIndex, payload.status);
    }
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-status', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log')
  async handleServiceLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { serviceIndex: number; log: string; timestamp?: string },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log', { agentCode, ...payload });
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

  @SubscribeMessage('register')
  async handleValidation(client: Socket, payload: { agentUuid: string | null }) {
    log(`[Agent Gateway] Validation Requested`, 200, 'TRACE')
    log(payload)
    const rawIp = (client.handshake.headers['x-forwarded-for'] as string) ?? client.handshake.address;
    const ip = rawIp === '::1' ? '127.0.0.1' : rawIp.replace(/^::ffff:/, '');

    const agent = await this.agentService.registerAgent(ip, payload.agentUuid);

    this.agentUuidToSocketId.set(agent.agentUuid, client.id);
    client.data.agentCode = agent.agentCode;
    client.data.agentUuid = agent.agentUuid;
    client.data.workspaceIndex = agent.agentParentWorkspace;
    client.emit('register', agent);
  }

  handleDisconnect(client: Socket) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = (client.data.agentUuid as string | undefined) ?? (client.handshake.auth as { agentUuid?: string }).agentUuid;
    log(`[Agent Gateway]: [Disconnected] ${agentUuid}`)
    if (agentCode && agentUuid) {
      this.agentUuidToSocketId.delete(agentUuid);
      void this.agentService.markAgentOffline(agentUuid);
    }
  }

  sendToAgent(agentUuid: string, event: string, payload: unknown): boolean {
    const socketId = this.agentUuidToSocketId.get(agentUuid);
    if (!socketId) return false;
    this.server.to(socketId).emit(event, payload);
    return true;
  }
}
