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

@Injectable()
@WebSocketGateway({ namespace: '/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly agentUuidToSocketId = new Map<string, string>();

  constructor(
    private readonly agentService: AgentService,
    @Inject(forwardRef(() => ConsoleGateway))
    private readonly consoleGateway: ConsoleGateway,
  ) { }

  @SubscribeMessage('response')
  handleResponse(@MessageBody() payload: unknown) {
    this.consoleGateway.server.emit('response', payload);
  }

  @SubscribeMessage('service-status')
  async handleServiceStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { serviceIndex: number; status: string },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const dbStatuses = ['waiting', 'building', 'running', 'stopped', 'failed', 'removed'];
    if (dbStatuses.includes(payload.status)) {
      await this.agentService.updateServiceStatus(payload.serviceIndex, payload.status);
    }
    this.consoleGateway.server.emit('service-status', { agentCode, ...payload });
  }

  @SubscribeMessage('service-log')
  handleServiceLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { serviceIndex: number; log: string; timestamp?: string },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    this.consoleGateway.server.emit('service-log', { agentCode, ...payload });
  }

  async handleConnection(client: Socket) {
    const raw = (client.handshake.headers['x-forwarded-for'] as string) ?? client.handshake.address;
    const ip = raw === '::1' ? '127.0.0.1' : raw.replace(/^::ffff:/, '');

    const agentUuid = (client.handshake.auth as { agentUuid?: string })?.agentUuid;
    const agent = await this.agentService.registerAgent(ip, agentUuid);

    this.agentUuidToSocketId.set(agent.agentUuid, client.id);
    client.data.agentCode = agent.agentCode;
    client.emit('connected', { agent });
  }

  handleDisconnect(client: Socket) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = (client.handshake.auth as { agentUuid: string }).agentUuid;
    log(`[Agent Gateway]: [Disconnected] ${agentUuid}`)
    if (agentCode) {
      this.agentUuidToSocketId.delete(agentUuid);
      void this.agentService.markAgentOffline(agentCode);
    }
  }

  sendToAgent(agentUuid: string, event: string, payload: unknown): boolean {
    const socketId = this.agentUuidToSocketId.get(agentUuid);
    if (!socketId) return false;
    this.server.to(socketId).emit(event, payload);
    return true;
  }
}
