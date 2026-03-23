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

  constructor(private readonly agentService: AgentService) {}

  async handleConnection(client: Socket) {
    const raw = (client.handshake.headers['x-forwarded-for'] as string) ?? client.handshake.address;
    const ip = raw === '::1' ? '127.0.0.1' : raw.replace(/^::ffff:/, '');

    const agentCode = await this.agentService.registerAgent(ip);

    client.emit('connected', { agentCode });
  }

  handleDisconnect(client: Socket) {
    this.agentService.markAgentOffline(client.id);
  }
}
