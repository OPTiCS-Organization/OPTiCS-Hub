import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { Server } from 'socket.io';
import { AgentGateway } from './agent.gateway';
import log from 'spectra-log';

@Injectable()
@WebSocketGateway({ namespace: '/console', cors: { origin: true, credentials: true } })
export class ConsoleGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(forwardRef(() => AgentGateway))
    private readonly agentGateway: AgentGateway,
  ) {}

  notifyAgentUpdated() {
    this.server.emit('agent-updated');
  }

  // 싸아갈 뭘 해야하지

  @SubscribeMessage('command')
  handleCommand(@MessageBody() payload: { agentCode: string; [key: string]: unknown }) {
    const { agentCode, ...rest } = payload;
    this.agentGateway.sendToAgent(agentCode, 'command', rest);
  }

  @SubscribeMessage('subscribe-log')
  handleSubscribeLog(@MessageBody() payload: { agentCode: string; serviceIndex: number; serviceName: string }) {
  log(`[{{ yellow : bold : Console Gateway }}] subscribe-log | agent=${payload.agentCode} | serviceIndex=${payload.serviceIndex} | name=${payload.serviceName}`);
    this.agentGateway.sendToAgent(payload.agentCode, 'command', {
      command: 'STREAM_LOG',
      serviceIndex: payload.serviceIndex,
      serviceName: payload.serviceName,
    });
  }

  @SubscribeMessage('unsubscribe-log')
  handleUnsubscribeLog(@MessageBody() payload: { agentCode: string; serviceName: string }) {
    log(`[{{ yellow : bold : Console Gateway }}] unsubscribe-log | agent=${payload.agentCode} | name=${payload.serviceName}`);
    this.agentGateway.sendToAgent(payload.agentCode, 'command', {
      command: 'STOP_LOG',
      serviceName: payload.serviceName,
    });
  }
}