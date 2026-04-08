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
  handleCommand(@MessageBody() payload: { agentUuid: string; [key: string]: unknown }) {
    const { agentUuid, ...rest } = payload;
    this.agentGateway.sendToAgent(agentUuid, 'command', rest);
  }

  @SubscribeMessage('subscribe-log')
  handleSubscribeLog(@MessageBody() payload: { agentUuid: string; serviceIndex: number; serviceName: string; deployPreset: string }) {
  log(`[{{ yellow : bold : Console Gateway }}] subscribe-log | agent=${payload.agentUuid} | serviceIndex=${payload.serviceIndex} | name=${payload.serviceName}`);
    this.agentGateway.sendToAgent(payload.agentUuid, 'command', {
      command: 'STREAM_LOG',
      serviceIndex: payload.serviceIndex,
      serviceName: payload.serviceName,
      deployPreset: payload.deployPreset,
    });
  }

  @SubscribeMessage('unsubscribe-log')
  handleUnsubscribeLog(@MessageBody() payload: { agentUuid: string; serviceName: string }) {
    log(`[{{ yellow : bold : Console Gateway }}] unsubscribe-log | agent=${payload.agentUuid} | name=${payload.serviceName}`);
    this.agentGateway.sendToAgent(payload.agentUuid, 'command', {
      command: 'STOP_LOG',
      serviceName: payload.serviceName,
    });
  }
}