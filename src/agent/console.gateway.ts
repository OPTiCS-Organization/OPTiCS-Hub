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

  notifyAgentUpdated() {
    this.server.emit('agent-updated');
  }

  notifyWorkspaceUpdated(workspaceIndex: number | null) {
    if (!workspaceIndex) {
      this.notifyAgentUpdated();
      return;
    }
    this.emitToWorkspace(workspaceIndex, 'agent-updated');
  }

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

  private readCookie(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map(cookie => cookie.trim());
    const target = cookies.find(cookie => cookie.startsWith(`${name}=`));
    return target ? decodeURIComponent(target.slice(name.length + 1)) : null;
  }

  private workspaceRoom(workspaceIndex: number): string {
    return `workspace:${workspaceIndex}`;
  }

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
        service_deleted_at: null,
      },
      select: { service_parent_agent: true },
    });
    if (!service) return false;

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: service.service_parent_agent,
        agent_uuid: agentUuid,
        agent_connection: 'linked',
        agent_deleted_at: null,
        parent: {
          workspace_index: workspaceIndex,
          workspace_owner: userIndex,
          workspace_deleted_at: null,
        },
      },
      select: { agent_index: true },
    });
    return Boolean(agent);
  }

  @SubscribeMessage('subscribe-workspace')
  async handleSubscribeWorkspace(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { workspaceIndex: number },
  ) {
    const workspaceIndex = Number(payload.workspaceIndex);
    if (!(await this.canAccessWorkspace(client, workspaceIndex))) return;
    await client.join(this.workspaceRoom(workspaceIndex));
  }

  emitToWorkspace(workspaceIndex: number, event: 'agent-updated' | 'service-status' | 'service-log' | 'response', payload?: object) {
    this.server.to(this.workspaceRoom(workspaceIndex)).emit(event, payload);
  }

  @SubscribeMessage('command')
  async handleCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { agentUuid: string; [key: string]: unknown },
  ) {
    const { agentUuid, ...rest } = payload;
    if (!(await this.canAccessAgent(client, agentUuid))) return;
    this.agentGateway.sendToAgent(agentUuid, 'command', rest);
  }

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
