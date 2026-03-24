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

@Injectable()
@WebSocketGateway({ namespace: '/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly agentCodeToSocketId = new Map<string, string>();

  constructor(
    private readonly agentService: AgentService,
    @Inject(forwardRef(() => ConsoleGateway))
    private readonly consoleGateway: ConsoleGateway,
  ) {}

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
    await this.agentService.updateServiceStatus(payload.serviceIndex, payload.status);
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

    const existingCode = (client.handshake.auth as { agentCode?: string })?.agentCode;
    const agentCode = await this.agentService.registerAgent(ip, existingCode);

    this.agentCodeToSocketId.set(agentCode.toUpperCase(), client.id);
    client.data.agentCode = agentCode;
    client.emit('connected', { agentCode });
  }

  handleDisconnect(client: Socket) {
    const agentCode = client.data.agentCode as string | undefined;
    if (agentCode) {
      this.agentCodeToSocketId.delete(agentCode.toUpperCase());
      void this.agentService.markAgentOffline(agentCode);
    }
  }

  sendToAgent(agentCode: string, event: string, payload: unknown): boolean {
    const socketId = this.agentCodeToSocketId.get(agentCode.toUpperCase());
    if (!socketId) return false;
    this.server.to(socketId).emit(event, payload);
    return true;
  }
}
