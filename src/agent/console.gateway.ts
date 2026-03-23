import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
@WebSocketGateway({ namespace: '/console', cors: { origin: true, credentials: true } })
export class ConsoleGateway {
  @WebSocketServer()
  server: Server;

  notifyAgentUpdated() {
    this.server.emit('agent-updated');
  }
}