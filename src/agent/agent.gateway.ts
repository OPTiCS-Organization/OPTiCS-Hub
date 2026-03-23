import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { AgentService } from './agent.service';

@Injectable()
@WebSocketGateway({ namespace: '/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly agentCodeToSocketId = new Map<string, string>();

  constructor(private readonly agentService: AgentService) {}

  async handleConnection(client: Socket) {
    const raw = (client.handshake.headers['x-forwarded-for'] as string) ?? client.handshake.address;
    const ip = raw === '::1' ? '127.0.0.1' : raw.replace(/^::ffff:/, '');

    const existingCode = (client.handshake.auth as { agentCode?: string })?.agentCode;
    const agentCode = existingCode ?? await this.agentService.registerAgent(ip);

    this.agentCodeToSocketId.set(agentCode, client.id);
    client.data.agentCode = agentCode;
    client.emit('connected', { agentCode });
  }

  handleDisconnect(client: Socket) {
    const agentCode = client.data.agentCode as string | undefined;
    if (agentCode) {
      this.agentCodeToSocketId.delete(agentCode);
    }
    this.agentService.markAgentOffline(client.id);
  }

  sendToAgent(agentCode: string, event: string, payload: unknown): boolean {
    const socketId = this.agentCodeToSocketId.get(agentCode);
    console.log(`[AgentGateway] sendToAgent | code=${agentCode} | socketId=${socketId ?? 'NOT FOUND'} | mapSize=${this.agentCodeToSocketId.size}`);
    if (!socketId) return false;
    this.server.to(socketId).emit(event, payload);
    return true;
  }
}
