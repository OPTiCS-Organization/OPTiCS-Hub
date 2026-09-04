import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { AgentGateway } from 'src/agent/agent.gateway';
import { ConsoleGateway } from 'src/agent/console.gateway';
import { DeployPreset, Prisma } from '@prisma/client';
import { ServiceEndpoint, ServicePortMapping, ServiceSourceRepository, ServiceSourceInput } from './types/service.type';
import { RedeployService } from './dto/RedeployService.dto';
import { AgentNotConnectedException } from 'src/global/exception/AgentNotConnected.exception';
import { BlockServiceTraffic } from './dto/BlockServiceTraffic.dto';
import { TunnelService } from 'src/tunnel/tunnel.service';

@Injectable()
export class ServiceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
    private readonly consoleGateway: ConsoleGateway,
    private readonly tunnelService: TunnelService,
  ) { };

  private parseServiceIndex(serviceIdx: string | number) {
    const parsed = Number(serviceIdx);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('Invalid Service Index.');
    }
    return parsed;
  }

  /** TODO: serviceIdx 타입 number로 변경 */
  private async findOwnedServiceAndAgent(owner: number, serviceIdx: string | number) {
    const serviceIndex = this.parseServiceIndex(serviceIdx); // 1
    const rawService = await this.prismaService.services.findFirst({
      where: {
        service_index: serviceIndex,
        service_deleted_at: null,
        workspace: {
          workspace_owner: owner,
          workspace_deleted_at: null,
        },
      },
    });
    if (!rawService) throw new NotFoundException('Service Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({  // 서비스가 배포된 에이전트와 연결이 끊어지면 재배포가 불가능하다.
      where: {
        agent_index: rawService.service_parent_agent,
        agent_parent_workspace: rawService.service_parent_workspace,
        agent_connection: 'linked',
        agent_deleted_at: null,
      },
    });
    // 에이전트의 연결이 끊어졌더라도 서비스의 재배포를 막아선 안된다.
    // if (!rawAgent) throw new NotFoundException('Service Not Found.');

    return { rawService, rawAgent };
  }

  private ensureCommandSent(sent: boolean) {
    if (!sent) {
      throw new ServiceUnavailableException('Agent is not connected.');
    }
  }

  private normalizeEnv(env: unknown): Record<string, string> {
    if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
    return Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, String(value)]),
    );
  }

  private normalizeRootDirectory(rootDirectory: unknown): string | null {
    const value = String(rootDirectory ?? '').trim().replace(/^\/+/, '');
    return value || null;
  }

  private normalizeServiceSubdomain(subdomain: string | null): string | null {
    if (subdomain === null) return null;
    const value = subdomain.trim().toLowerCase();
    return value === '@' ? '' : value;
  }

  private assertServiceSubdomainFormat(subdomain: string | null) {
    if (subdomain === null || subdomain === '') return;
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      throw new BadRequestException('Invalid Service Subdomain.');
    }
  }

  private normalizeSourceRepositories(input: unknown, fallbackRootDirectory?: unknown): ServiceSourceRepository[] {
    let entries: ServiceSourceRepository[];
    if (typeof input === 'string') {
      entries = [{ url: input, rootDirectory: this.normalizeRootDirectory(fallbackRootDirectory) }];
    } else if (Array.isArray(input)) {
      entries = input.map((entry) => {
        if (typeof entry === 'string') {
          return { url: entry, rootDirectory: null };
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          return {
            url: String(record.url ?? record.sourceUrl ?? '').trim(),
            rootDirectory: this.normalizeRootDirectory(record.rootDirectory),
          };
        }
        return { url: '', rootDirectory: null };
      });
    } else {
      entries = [];
    }

    const normalized = entries
      .map(entry => ({
        url: entry.url.trim(),
        rootDirectory: this.normalizeRootDirectory(entry.rootDirectory),
      }))
      .filter(entry => entry.url);

    if (normalized.length === 0) throw new BadRequestException('At least one source repository is required.');
    return normalized;
  }

  private serializeSourceRepositories(entries: ServiceSourceRepository[]) {
    return entries.length === 1 && !entries[0].rootDirectory
      ? entries[0].url
      : JSON.stringify(entries);
  }

  private normalizePortMappings(input: unknown, fallbackHostPort?: number, fallbackContainerPort?: number): ServicePortMapping[] {
    const rawMappings = Array.isArray(input) ? input : [];
    const mappings = rawMappings.map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const hostPort = Number(record.hostPort ?? record.serviceHostPort);
      const containerPort = Number(record.containerPort ?? record.serviceContainerPort);
      if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) return null;
      if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) return null;
      return { hostPort, containerPort };
    }).filter((entry): entry is ServicePortMapping => entry !== null);

    if (mappings.length === 0 && fallbackHostPort !== undefined && fallbackContainerPort !== undefined) {
      mappings.push({ hostPort: fallbackHostPort, containerPort: fallbackContainerPort });
    }
    if (mappings.length === 0) throw new BadRequestException('At least one port mapping is required.');

    const hostPorts = new Set<number>();
    const containerPorts = new Set<number>();
    for (const mapping of mappings) {
      if (hostPorts.has(mapping.hostPort)) throw new BadRequestException(`Duplicate host port: ${mapping.hostPort}`);
      if (containerPorts.has(mapping.containerPort)) throw new BadRequestException(`Duplicate container port: ${mapping.containerPort}`);
      hostPorts.add(mapping.hostPort);
      containerPorts.add(mapping.containerPort);
    }

    return mappings;
  }

  private defaultComponentName(serviceName: string, deployPreset: DeployPreset) {
    return deployPreset === DeployPreset.compose ? serviceName : 'app';
  }

  private normalizeEndpoints(
    input: unknown,
    portMappings: ServicePortMapping[],
    serviceName: string,
    deployPreset: DeployPreset,
    existingPrimarySubdomain: string | null = null,
  ): ServiceEndpoint[] {
    const defaultComponentName = this.defaultComponentName(serviceName, deployPreset);
    const rawEndpoints = Array.isArray(input) ? input : [];
    const endpoints: ServiceEndpoint[] = rawEndpoints.map((entry): ServiceEndpoint | null => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;
      const hostPort = Number(record.hostPort ?? record.endpointHostPort);
      const containerPort = Number(record.containerPort ?? record.endpointContainerPort);
      if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) return null;
      if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) return null;
      const subdomain = this.normalizeServiceSubdomain(record.subdomain === undefined ? null : String(record.subdomain));
      this.assertServiceSubdomainFormat(subdomain);
      return {
        hostPort,
        containerPort,
        componentName: String(record.componentName ?? record.endpointComponentName ?? defaultComponentName).trim() || defaultComponentName,
        subdomain,
      };
    }).filter((entry): entry is ServiceEndpoint => entry !== null);

    if (endpoints.length > 0) return endpoints;

    return portMappings.map((mapping, index) => ({
      ...mapping,
      componentName: defaultComponentName,
      subdomain: index === 0 ? existingPrimarySubdomain : null,
    }));
  }

  private async replaceServiceEndpoints(
    serviceIndex: number,
    workspaceIndex: number,
    endpoints: ServiceEndpoint[],
  ) {
    const publicSubdomains = endpoints
      .map(endpoint => endpoint.subdomain)
      .filter((subdomain): subdomain is string => subdomain !== null && subdomain !== undefined);
    if (new Set(publicSubdomains).size !== publicSubdomains.length) {
      throw new ConflictException('Duplicate Endpoint Subdomain.');
    }

    if (publicSubdomains.length > 0) {
      const duplicate = await this.prismaService.service_endpoints.findFirst({
        where: {
          endpoint_parent_workspace: workspaceIndex,
          endpoint_parent_service: { not: serviceIndex },
          endpoint_subdomain: { in: publicSubdomains },
          endpoint_deleted_at: null,
        },
      });
      if (duplicate) throw new ConflictException('Endpoint Subdomain Already In Use.');
    }

    await this.prismaService.service_endpoints.deleteMany({
      where: { endpoint_parent_service: serviceIndex },
    });

    if (endpoints.length === 0) return;

    await this.prismaService.service_endpoints.createMany({
      data: endpoints.map(endpoint => ({
        endpoint_parent_workspace: workspaceIndex,
        endpoint_parent_service: serviceIndex,
        endpoint_component_name: endpoint.componentName ?? null,
        endpoint_subdomain: endpoint.subdomain ?? null,
        endpoint_host_port: endpoint.hostPort,
        endpoint_container_port: endpoint.containerPort,
      })),
    });
  }

  private async ensureDefaultComponent(
    serviceIndex: number,
    serviceName: string,
    deployPreset: DeployPreset,
  ) {
    const componentName = this.defaultComponentName(serviceName, deployPreset);
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
        component_container_name: deployPreset === DeployPreset.compose ? null : serviceName.toLowerCase(),
        component_status: 'waiting',
      },
      update: {
        component_deleted_at: null,
      },
    });
  }

  async handleCreateService(
    owner: number,
    body: {
      workspaceIdx: number,
      serviceName: string;
      servicePort: number;
      serviceContainerPort?: number;
      serviceHostPort?: number;
      servicePortMappings?: ServicePortMapping[];
      serviceEndpoints?: ServiceEndpoint[];
      serviceSourceUrl: ServiceSourceInput;
      serviceRootDirectory?: string;
      serviceVersion: string;
      serviceDeployPreset: DeployPreset;
      agentIndex: number;
      env?: Record<string, string>;
    },
  ) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: { workspace_index: body.workspaceIdx, workspace_owner: owner, workspace_deleted_at: null },
    });
    if (!workspace) throw new NotFoundException('Workspace Not Found.');

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: body.agentIndex,
        agent_parent_workspace: body.workspaceIdx,
        agent_connection: 'linked',
        agent_deleted_at: null,
      },
    });
    if (!agent) throw new NotFoundException('Agent Not Found.');

    const duplicatedService = await this.prismaService.services.findFirst({
      where: {
        service_parent_workspace: body.workspaceIdx,
        service_name: body.serviceName,
        service_deleted_at: null,
        service_status: { not: 'removed' },
      },
      select: { service_index: true },
    });
    if (duplicatedService) throw new ConflictException('Service Name Already Exists in This Workspace.');

    const sourceRepositories = this.normalizeSourceRepositories(body.serviceSourceUrl, body.serviceRootDirectory);
    const sourceUrlStored = this.serializeSourceRepositories(sourceRepositories);
    const hostPort = body.serviceHostPort ?? body.servicePort;
    const containerPort = body.serviceContainerPort ?? body.servicePort;
    const portMappings = this.normalizePortMappings(body.servicePortMappings, hostPort, containerPort);
    const endpoints = this.normalizeEndpoints(body.serviceEndpoints, portMappings, body.serviceName, body.serviceDeployPreset);
    const primaryPortMapping = portMappings[0];
    const rootDirectory = sourceRepositories[0].rootDirectory;
    const env = this.normalizeEnv(body.env);

    const raw = await this.prismaService.services.create({
      data: {
        service_name: body.serviceName,
        service_port: primaryPortMapping.hostPort,
        service_host_port: primaryPortMapping.hostPort,
        service_container_port: primaryPortMapping.containerPort,
        service_port_mappings: portMappings as unknown as Prisma.InputJsonArray,
        service_source_url: sourceUrlStored,
        service_root_directory: rootDirectory,
        service_env: env as Prisma.InputJsonObject,
        service_version: body.serviceVersion,
        service_deploy_preset: body.serviceDeployPreset as any,
        service_parent_workspace: body.workspaceIdx,
        service_parent_agent: body.agentIndex,
      },
    });
    await this.ensureDefaultComponent(raw.service_index, raw.service_name, raw.service_deploy_preset);
    await this.replaceServiceEndpoints(raw.service_index, body.workspaceIdx, endpoints);

    const sent = this.agentGateway.sendToAgent(agent.agent_uuid, 'command', {
      command: 'DEPLOY',
      serviceIndex: raw.service_index,
      sourceUrl: sourceRepositories,
      rootDirectory,
      deployPreset: body.serviceDeployPreset,
      serviceName: body.serviceName,
      servicePort: primaryPortMapping.hostPort,
      serviceHostPort: primaryPortMapping.hostPort,
      serviceContainerPort: primaryPortMapping.containerPort,
      servicePortMappings: portMappings,
      serviceVersion: body.serviceVersion,
      env,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: raw.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(body.workspaceIdx);
      this.ensureCommandSent(sent);
    }

    this.consoleGateway.notifyWorkspaceUpdated(body.workspaceIdx);
    return toCamelCase(raw);
  }

  async handleDeleteService(owner: number, serviceIdx: string, deleteScope: 'containers' | 'service' = 'containers') {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    const scope = deleteScope === 'service' ? 'service' : 'containers';

    if (!rawAgent) throw new AgentNotConnectedException();
    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
      command: 'DELETE',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      deployPreset: rawService.service_deploy_preset,
      deleteScope: scope,
    });
    this.ensureCommandSent(sent);

    await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: {
        service_status: 'removed',
        service_deleted_at: scope === 'service' ? new Date() : null,
      },
    });
    this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);

    return { serviceIndex: rawService.service_index, deleteScope: scope };
  }

  /**
   * 재배포 시 Workspace는 변경할 수 없음
   * 기존 Agent와 다른 Agent에 배포 할 때 기존 Agent에서 데이터를 이전할 수 없음
   * @param owner
   * @param serviceIdx
   * @param body
   * @returns
   */
  async handleRedeployService(
    owner: number,
    serviceIdx: string,
    body: RedeployService,
  ) {
    /* Service를 소유한 Agent를 찾음 */
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);

    // 변경 대상 Agent를 찾음
    const targetAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: body.agentIndex,
        agent_parent_workspace: rawService.service_parent_workspace,
        agent_status: 'online',
        agent_deleted_at: null,
      },
      select: {
        agent_uuid: true,
        agent_index: true,
      }
    });

    // Target Agent가 Online인지 확인해야 함

    if (!targetAgent) throw new NotFoundException('Target agent is offline or deleted.');

    // 배포 대상 Agent가 변경되었고, 기존 Agent가 온라인인 경우, 해당 Agent에서 동작중인 Service 중지
    if (body.agentIndex && rawService.service_parent_agent !== body.agentIndex && rawAgent && rawAgent.agent_status == 'online')
      await this.handleStopService(owner, String(rawService.service_index));

    const rawSourceUrlForUpdate = body.serviceSourceUrl ?? rawService.service_source_url;
    const parsedSourceUrlForUpdate = (() => {
      try {
        return typeof rawSourceUrlForUpdate === 'string' ? JSON.parse(rawSourceUrlForUpdate) : rawSourceUrlForUpdate;
      } catch {
        return rawSourceUrlForUpdate;
      }
    })();
    const sourceRepositories = this.normalizeSourceRepositories(parsedSourceUrlForUpdate, body.serviceRootDirectory ?? rawService.service_root_directory);
    const sourceUrlStored = this.serializeSourceRepositories(sourceRepositories);
    const sourceUrlForAgent = sourceRepositories;
    const hostPort = body.serviceHostPort ?? body.servicePort ?? rawService.service_host_port ?? rawService.service_port;
    const containerPort = body.serviceContainerPort ?? body.servicePort ?? rawService.service_container_port ?? rawService.service_port;
    const existingPortMappings = this.normalizePortMappings((rawService as any).service_port_mappings, hostPort, containerPort);
    const portMappings = body.servicePortMappings !== undefined
      ? this.normalizePortMappings(body.servicePortMappings, hostPort, containerPort)
      : existingPortMappings;
    const existingPrimaryEndpoint = await this.prismaService.service_endpoints.findFirst({
      where: {
        endpoint_parent_service: rawService.service_index,
        endpoint_subdomain: { not: null },
      },
      orderBy: { endpoint_index: 'asc' },
    });
    const primaryPortMapping = portMappings[0];
    const rootDirectory = sourceRepositories[0].rootDirectory;
    const env = body.env !== undefined
      ? this.normalizeEnv(body.env)
      : this.normalizeEnv(rawService.service_env);

    if (body.serviceName && body.serviceName !== rawService.service_name) {
      const duplicatedService = await this.prismaService.services.findFirst({
        where: {
          service_parent_workspace: rawService.service_parent_workspace,
          service_name: body.serviceName,
          service_deleted_at: null,
          service_status: { not: 'removed' },
          service_index: { not: rawService.service_index },
        },
        select: { service_index: true },
      });
      if (duplicatedService) throw new ConflictException('Service Name Already Exists in This Workspace.');
    }

    const updatedService = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: {
        service_name: body.serviceName ?? rawService.service_name,
        service_port: primaryPortMapping.hostPort,
        service_host_port: primaryPortMapping.hostPort,
        service_container_port: primaryPortMapping.containerPort,
        service_port_mappings: portMappings as unknown as Prisma.InputJsonArray,
        service_source_url: sourceUrlStored,
        service_root_directory: rootDirectory,
        service_env: env as Prisma.InputJsonObject,
        service_parent_agent: targetAgent.agent_index,
        service_version: body.serviceVersion ?? rawService.service_version,
        service_deploy_preset: (body.serviceDeployPreset ?? rawService.service_deploy_preset) as any,
      },
    });
    const endpoints = this.normalizeEndpoints(
      body.serviceEndpoints,
      portMappings,
      updatedService.service_name,
      updatedService.service_deploy_preset,
      existingPrimaryEndpoint?.endpoint_subdomain ?? rawService.service_subdomain,
    );
    await this.ensureDefaultComponent(updatedService.service_index, updatedService.service_name, updatedService.service_deploy_preset);
    await this.replaceServiceEndpoints(updatedService.service_index, updatedService.service_parent_workspace, endpoints);


    // 배포 대상 Agent가 변경되어도 REDEPLOY 명령은 DEPLOY 명령과 동일하게 동작함.
    // REDEPLOY 명령은 기존에 동작중인 컨테이너를 중지하는 프로세스를 추가로 가지고 있음.
    const sent = this.agentGateway.sendToAgent(targetAgent.agent_uuid, 'command', {
      command: 'REDEPLOY',
      serviceIndex: updatedService.service_index,
      sourceUrl: sourceUrlForAgent,
      rootDirectory,
      deployPreset: updatedService.service_deploy_preset,
      serviceName: updatedService.service_name,
      servicePort: updatedService.service_host_port ?? updatedService.service_port,
      serviceHostPort: updatedService.service_host_port ?? updatedService.service_port,
      serviceContainerPort: updatedService.service_container_port ?? updatedService.service_port,
      servicePortMappings: portMappings,
      serviceVersion: updatedService.service_version,
      env,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: updatedService.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return toCamelCase(updatedService);
  }

  async handleStartService(owner: number, serviceIdx: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service must be redeployed before it can be started.');
    }

    if (!rawAgent) throw new AgentNotConnectedException();
    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
      command: 'START',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      servicePort: rawService.service_host_port ?? rawService.service_port,
      serviceHostPort: rawService.service_host_port ?? rawService.service_port,
      serviceContainerPort: rawService.service_container_port ?? rawService.service_port,
      serviceVersion: rawService.service_version,
      deployPreset: rawService.service_deploy_preset,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: rawService.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
      this.ensureCommandSent(sent);
    }

    this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
    return { serviceIndex: rawService.service_index };
  }

  async handleStopService(owner: number, serviceIdx: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service cannot be stopped.');
    }

    if (!rawAgent) throw new AgentNotConnectedException();
    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
      command: 'STOP',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      servicePort: rawService.service_host_port ?? rawService.service_port,
      serviceHostPort: rawService.service_host_port ?? rawService.service_port,
      serviceContainerPort: rawService.service_container_port ?? rawService.service_port,
      serviceVersion: rawService.service_version,
      deployPreset: rawService.service_deploy_preset,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: rawService.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
      this.ensureCommandSent(sent);
    }

    this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
    return { serviceIndex: rawService.service_index };
  }

  /**
   * 이 서비스로 가는 트래픽을 끊는다.
   *
   * 컨테이너에는 손대지 않는다. STOP과는 다른 동작이고, 그래야 하는 이유가 있다.
   * 트래픽만 끊으면 서비스는 그대로 돌면서 큐를 비우거나 배치를 마칠 수 있고,
   * 운영자는 외부 노출만 즉시 막을 수 있다. 컨테이너까지 내리면 되돌리는 데
   * 재시작 시간이 들고, 그 사이 상태가 날아가는 서비스도 있다.
   *
   * Agent가 끊겨 있어도 걸린다. 차단은 Hub의 라우팅 판단이라 Agent와 무관하다.
   */
  async handleBlockServiceTraffic(owner: number, serviceIdx: string, options: BlockServiceTraffic) {
    const { rawService } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service has no traffic to block.');
    }

    /*
     * 이미 막혀 있어도 거절하지 않고 덮어쓴다. 모드나 사유만 바꾸려는 호출이
     * 409로 튕기면 '풀었다 다시 막기'를 시켜야 하고, 그 사이가 구멍이 된다.
     * blocked_at은 처음 막은 시각을 지키기 위해 이미 값이 있으면 두고 간다.
     */
    const updated = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: {
        service_traffic_blocked_at: rawService.service_traffic_blocked_at ?? new Date(),
        service_traffic_block_mode: options.mode ?? 'notice',
        service_traffic_block_reason: options.reason?.trim() || null,
      },
    });

    this.tunnelService.invalidateRouteCache();
    this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
    return this.toTrafficBlockView(updated);
  }

  /** 차단을 푼다. 사유와 모드는 다음 차단 때 다시 받으므로 같이 비운다. */
  async handleUnblockServiceTraffic(owner: number, serviceIdx: string) {
    const { rawService } = await this.findOwnedServiceAndAgent(owner, serviceIdx);

    const updated = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: {
        service_traffic_blocked_at: null,
        service_traffic_block_reason: null,
        service_traffic_block_mode: 'notice',
      },
    });

    this.tunnelService.invalidateRouteCache();
    this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
    return this.toTrafficBlockView(updated);
  }

  private toTrafficBlockView(service: {
    service_index: number;
    service_traffic_blocked_at: Date | null;
    service_traffic_block_mode: string;
    service_traffic_block_reason: string | null;
  }) {
    return {
      serviceIndex: service.service_index,
      trafficBlockedAt: service.service_traffic_blocked_at,
      trafficBlockMode: service.service_traffic_block_mode,
      trafficBlockReason: service.service_traffic_block_reason,
    };
  }

  async handleStartContainer(owner: number, serviceIdx: string, containerName: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service must be redeployed before containers can be started.');
    }

    if (!rawAgent) throw new AgentNotConnectedException();
    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
      command: 'CONTAINER_START',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      deployPreset: rawService.service_deploy_preset,
      containerName,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: rawService.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return { serviceIndex: rawService.service_index, containerName };
  }

  async handleStopContainer(owner: number, serviceIdx: string, containerName: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service containers cannot be stopped.');
    }

    if (!rawAgent) throw new AgentNotConnectedException();
    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
      command: 'CONTAINER_STOP',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      deployPreset: rawService.service_deploy_preset,
      containerName,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: rawService.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return { serviceIndex: rawService.service_index, containerName };
  }

  async handleRestartContainer(owner: number, serviceIdx: string, containerName: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service must be redeployed before containers can be restarted.');
    }

    if (!rawAgent) throw new AgentNotConnectedException();
    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
      command: 'CONTAINER_RESTART',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      deployPreset: rawService.service_deploy_preset,
      containerName,
    });
    if (!sent) {
      await this.prismaService.services.update({
        where: { service_index: rawService.service_index },
        data: { service_status: 'failed' },
      });
      this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return { serviceIndex: rawService.service_index, containerName };
  }

  async handleUpdateServiceSubdomain(owner: number, serviceIdx: string, subdomain: string | null) {
    const { rawService } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    const normalizedSubdomain = this.normalizeServiceSubdomain(subdomain);
    this.assertServiceSubdomainFormat(normalizedSubdomain);

    if (normalizedSubdomain !== null) {
      const duplicate = await this.prismaService.service_endpoints.findFirst({
        where: {
          endpoint_subdomain: normalizedSubdomain,
          endpoint_parent_workspace: rawService.service_parent_workspace,
          endpoint_parent_service: { not: rawService.service_index },
          endpoint_deleted_at: null,
        },
      });
      if (duplicate) throw new ConflictException('Subdomain Already In Use.');
    }

    const primaryEndpoint = await this.prismaService.service_endpoints.findFirst({
      where: { endpoint_parent_service: rawService.service_index },
      orderBy: { endpoint_index: 'asc' },
    });

    if (primaryEndpoint) {
      await this.prismaService.service_endpoints.update({
        where: { endpoint_index: primaryEndpoint.endpoint_index },
        data: { endpoint_subdomain: normalizedSubdomain },
      });
    } else if (normalizedSubdomain !== null) {
      await this.prismaService.service_endpoints.create({
        data: {
          endpoint_parent_workspace: rawService.service_parent_workspace,
          endpoint_parent_service: rawService.service_index,
          endpoint_component_name: this.defaultComponentName(rawService.service_name, rawService.service_deploy_preset),
          endpoint_subdomain: normalizedSubdomain,
          endpoint_host_port: rawService.service_host_port ?? rawService.service_port,
          endpoint_container_port: rawService.service_container_port ?? rawService.service_port,
        },
      });
    }

    const updated = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: { service_subdomain: normalizedSubdomain },
    });

    return {
      serviceIndex: updated.service_index,
      serviceSubdomain: updated.service_subdomain,
    };
  }

  async handleUpdateServiceEndpoints(owner: number, serviceIdx: string, serviceEndpoints: ServiceEndpoint[]) {
    const { rawService } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    const hostPort = rawService.service_host_port ?? rawService.service_port;
    const containerPort = rawService.service_container_port ?? rawService.service_port;
    const fallbackPortMappings = this.normalizePortMappings((rawService as any).service_port_mappings, hostPort, containerPort);
    const endpoints = this.normalizeEndpoints(
      serviceEndpoints,
      fallbackPortMappings,
      rawService.service_name,
      rawService.service_deploy_preset,
      rawService.service_subdomain,
    );

    await this.replaceServiceEndpoints(rawService.service_index, rawService.service_parent_workspace, endpoints);

    const primaryEndpoint = endpoints.find(endpoint => endpoint.subdomain !== null) ?? endpoints[0] ?? null;
    const updated = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: { service_subdomain: primaryEndpoint?.subdomain ?? null },
    });

    this.consoleGateway.notifyWorkspaceUpdated(rawService.service_parent_workspace);

    return {
      serviceIndex: updated.service_index,
      serviceSubdomain: updated.service_subdomain,
      endpoints: endpoints.map(endpoint => ({
        componentName: endpoint.componentName ?? null,
        subdomain: endpoint.subdomain ?? null,
        hostPort: endpoint.hostPort,
        containerPort: endpoint.containerPort,
      })),
    };
  }

  async handleGetServiceList(owner: number, workspaceIdx: number) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: { workspace_index: workspaceIdx, workspace_owner: owner, workspace_deleted_at: null },
    });

    if (!workspace) throw new NotFoundException('Workspace Not Found.');

    const rawServices = await this.prismaService.services.findMany({
      where: { service_parent_workspace: workspaceIdx, service_deleted_at: null },
      orderBy: { service_created_at: 'desc' },
      include: {
        agent: {
          select: {
            agent_code: true,
            agent_name: true,
            agent_uuid: true,
          },
        },
        components: {
          where: { component_deleted_at: null },
          orderBy: { component_index: 'asc' },
        },
        endpoints: {
          where: { endpoint_deleted_at: null },
          orderBy: { endpoint_index: 'asc' },
        },
      },
    });

    return rawServices.map(s => {
      const endpointPortMappings = s.endpoints.map(endpoint => ({
        hostPort: endpoint.endpoint_host_port,
        containerPort: endpoint.endpoint_container_port,
      }));
      const fallbackPortMappings = this.normalizePortMappings((s as any).service_port_mappings, s.service_host_port ?? s.service_port, s.service_container_port ?? s.service_port);
      const primaryEndpoint = s.endpoints.find(endpoint => endpoint.endpoint_subdomain !== null) ?? s.endpoints[0] ?? null;

      return {
        serviceIndex: s.service_index,
        serviceName: s.service_name,
        servicePort: s.service_port,
        serviceHostPort: s.service_host_port ?? s.service_port,
        serviceContainerPort: s.service_container_port ?? s.service_port,
        servicePortMappings: endpointPortMappings.length > 0 ? endpointPortMappings : fallbackPortMappings,
        serviceSourceUrl: s.service_source_url,
        serviceRootDirectory: s.service_root_directory,
        serviceEnv: this.normalizeEnv(s.service_env),
        serviceStatus: s.service_status,
        trafficBlockedAt: s.service_traffic_blocked_at,
        trafficBlockMode: s.service_traffic_block_mode,
        trafficBlockReason: s.service_traffic_block_reason,
        serviceSubdomain: primaryEndpoint?.endpoint_subdomain ?? s.service_subdomain,
        serviceVersion: s.service_version,
        serviceDeployPreset: s.service_deploy_preset,
        serviceCreatedAt: s.service_created_at,
        agentIndex: s.service_parent_agent,
        agentCode: s.agent?.agent_code ?? null,
        agentName: s.agent?.agent_name ?? null,
        agentUuid: s.agent?.agent_uuid ?? null,
        components: s.components.map(component => ({
          componentIndex: component.component_index,
          componentName: component.component_name,
          containerName: component.component_container_name,
          status: component.component_status,
          health: component.component_health,
          exitCode: component.component_exit_code,
          updatedAt: component.component_updated_at,
        })),
        endpoints: s.endpoints.map(endpoint => ({
          endpointIndex: endpoint.endpoint_index,
          componentName: endpoint.endpoint_component_name,
          subdomain: endpoint.endpoint_subdomain,
          hostPort: endpoint.endpoint_host_port,
          containerPort: endpoint.endpoint_container_port,
        })),
      };
    });
  }
}
