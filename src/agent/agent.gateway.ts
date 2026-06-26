import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ConsoleGateway } from './console.gateway';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { ServiceComponentStatus } from '@prisma/client';

type ServiceLogPayload = {
  serviceIndex: number;
  log: string;
  timestamp?: string;
  source?: 'hub' | 'agent' | 'runtime';
  stream?: 'deploy' | 'lifecycle' | 'runtime';
  containerName?: string;
  composeService?: string;
  stderr?: boolean;
};

@Injectable()
@WebSocketGateway({ namespace: '/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly agentUuidToSocketId = new Map<string, string>();
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private readonly agentService: AgentService,
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConsoleGateway))
    private readonly consoleGateway: ConsoleGateway,
  ) { }

  private async getWorkspaceIndexForAgentService(agentUuid: string, serviceIndex: number): Promise<number | null> {
    const service = await this.prismaService.services.findFirst({
      where: { service_index: serviceIndex, service_deleted_at: null },
      select: { service_parent_agent: true, service_parent_workspace: true },
    });
    if (!service) return null;

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: service.service_parent_agent,
        agent_uuid: agentUuid,
        agent_connection: 'linked',
        agent_deleted_at: null,
      },
      select: { agent_index: true },
    });
    if (!agent) return null;

    return service.service_parent_workspace;
  }

  private normalizeComponentStatus(status: string): ServiceComponentStatus {
    const validStatuses: ServiceComponentStatus[] = ['waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed', 'restarting'];
    return validStatuses.includes(status as ServiceComponentStatus)
      ? status as ServiceComponentStatus
      : 'stopped';
  }

  private async syncServiceComponents(
    serviceIndex: number,
    containers: { name: string; status: string; service?: string; exitCode?: number | null; health?: string | null }[],
  ) {
    const service = await this.prismaService.services.findFirst({
      where: { service_index: serviceIndex, service_deleted_at: null },
      select: { service_name: true, service_deploy_preset: true },
    });
    if (!service) return;

    const seenNames = new Set<string>();
    for (const container of containers) {
      const componentName = container.service?.trim()
        || (service.service_deploy_preset === 'compose' ? container.name : 'app');
      if (!componentName) continue;
      seenNames.add(componentName);

      await this.prismaService.service_components.upsert({
        where: {
          component_parent_service_component_name: {
            component_parent_service: serviceIndex,
            component_name: componentName,
          },
        },
        create: {
          component_parent_service: serviceIndex,
          component_name: componentName,
          component_container_name: container.name,
          component_status: this.normalizeComponentStatus(container.status),
          component_health: container.health ?? null,
          component_exit_code: container.exitCode ?? null,
        },
        update: {
          component_container_name: container.name,
          component_status: this.normalizeComponentStatus(container.status),
          component_health: container.health ?? null,
          component_exit_code: container.exitCode ?? null,
          component_deleted_at: null,
        },
      });
    }

    if (containers.length === 0) {
      await this.prismaService.service_components.updateMany({
        where: { component_parent_service: serviceIndex, component_deleted_at: null },
        data: { component_status: 'removed' },
      });
      return;
    }

    await this.prismaService.service_components.updateMany({
      where: {
        component_parent_service: serviceIndex,
        component_deleted_at: null,
        component_name: { notIn: [...seenNames] },
      },
      data: { component_status: 'removed' },
    });
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

  @SubscribeMessage('container-status')
  async handleContainerStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      serviceIndex: number;
      containers: { name: string; status: string; service?: string; exitCode?: number | null; health?: string | null }[];
      counts?: { running: number; total: number };
    },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (!workspaceIndex) return;
    await this.syncServiceComponents(payload.serviceIndex, payload.containers).catch((error: unknown) => {
      log(`[Agent Gateway] Failed to sync service components | serviceIndex=${payload.serviceIndex} | ${String(error)}`, 500, 'ERROR');
    });
    this.consoleGateway.emitToWorkspace(workspaceIndex, 'container-status', { agentCode, ...payload });
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

    const dbStatuses = ['waiting', 'building', 'starting', 'running', 'stopped', 'failed', 'removed'];
    if (dbStatuses.includes(payload.status)) {
      await this.agentService.updateServiceStatus(payload.serviceIndex, payload.status).catch((error: unknown) => {
        log(`[Agent Gateway] Failed to update service status | serviceIndex=${payload.serviceIndex} | status=${payload.status} | ${String(error)}`, 500, 'ERROR');
      });
    }
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-status', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log')
  async handleServiceLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ServiceLogPayload,
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('log-load-progress')
  async handleLogLoadProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { serviceIndex: number; loaded: number; total: number; percent: number; phase: string },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'log-load-progress', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log-history')
  async handleServiceLogHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      serviceIndex: number;
      logs: {
        line: string;
        timestamp?: string;
        source?: 'hub' | 'agent' | 'runtime';
        stream?: 'deploy' | 'lifecycle' | 'runtime';
        containerName?: string;
        composeService?: string;
        stderr?: boolean;
      }[];
      markers?: { serviceIndex: number; serviceName: string; containerName: string; event: string; timestamp: string }[];
      before?: string;
      hasMore?: boolean;
    },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log-history', { agentCode, ...payload });
    }
  }

  @SubscribeMessage('service-log-markers')
  async handleServiceLogMarkers(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      serviceIndex: number;
      markers: { serviceIndex: number; serviceName: string; containerName: string; event: string; timestamp: string }[];
    },
  ) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = client.data.agentUuid as string | undefined;
    if (!agentUuid) return;
    const workspaceIndex = await this.getWorkspaceIndexForAgentService(agentUuid, payload.serviceIndex);
    if (workspaceIndex) {
      this.consoleGateway.emitToWorkspace(workspaceIndex, 'service-log-markers', { agentCode, ...payload });
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

    this.clearOfflineTimer(agent.agentUuid);
    this.agentUuidToSocketId.set(agent.agentUuid, client.id);
    client.data.agentCode = agent.agentCode;
    client.data.agentUuid = agent.agentUuid;
    client.data.workspaceIndex = agent.agentParentWorkspace;
    client.emit('register', agent);
    this.consoleGateway.notifyWorkspaceUpdated(agent.agentParentWorkspace);
  }

  handleDisconnect(client: Socket) {
    const agentCode = client.data.agentCode as string | undefined;
    const agentUuid = (client.data.agentUuid as string | undefined) ?? (client.handshake.auth as { agentUuid?: string }).agentUuid;
    log(`[Agent Gateway]: [Disconnected] ${agentUuid}`)
    if (agentCode && agentUuid) {
      if (this.agentUuidToSocketId.get(agentUuid) !== client.id) return;
      this.agentUuidToSocketId.delete(agentUuid);
      this.scheduleOffline(agentUuid);
    }
  }

  sendToAgent(agentUuid: string, event: string, payload: unknown): boolean {
    const socketId = this.agentUuidToSocketId.get(agentUuid);
    if (!socketId) return false;
    this.server.to(socketId).emit(event, payload);
    return true;
  }

  disconnectAgent(agentUuid: string): boolean {
    const socketId = this.agentUuidToSocketId.get(agentUuid);
    if (!socketId) return false;

    const socket = this.server.sockets.sockets.get(socketId);
    socket?.emit('command', { command: 'DISCONNECT' });
    setTimeout(() => socket?.disconnect(true), 250);
    this.agentUuidToSocketId.delete(agentUuid);
    this.clearOfflineTimer(agentUuid);
    return true;
  }

  isAgentConnected(agentUuid: string): boolean {
    return this.agentUuidToSocketId.has(agentUuid);
  }

  private scheduleOffline(agentUuid: string) {
    this.clearOfflineTimer(agentUuid);
    const timer = setTimeout(() => {
      this.offlineTimers.delete(agentUuid);
      if (this.agentUuidToSocketId.has(agentUuid)) return;
      void this.agentService.markAgentOffline(agentUuid);
    }, 3000);
    this.offlineTimers.set(agentUuid, timer);
  }

  private clearOfflineTimer(agentUuid: string) {
    const timer = this.offlineTimers.get(agentUuid);
    if (!timer) return;
    clearTimeout(timer);
    this.offlineTimers.delete(agentUuid);
  }
}
