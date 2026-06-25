import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { AgentGateway } from 'src/agent/agent.gateway';
import { ConsoleGateway } from 'src/agent/console.gateway';
import { DeployPreset, Prisma } from '@prisma/client';
import { ServicePortMapping, ServiceSourceRepository, ServiceSourceInput } from './types/service.type';

@Injectable()
export class ServiceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
    private readonly consoleGateway: ConsoleGateway,
  ) { };

  private parseServiceIndex(serviceIdx: string) {
    const parsed = Number(serviceIdx);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('Invalid Service Index.');
    }
    return parsed;
  }

  private async findOwnedServiceAndAgent(owner: number, serviceIdx: string) {
    const serviceIndex = this.parseServiceIndex(serviceIdx);
    const rawService = await this.prismaService.services.findFirst({
      where: {
        service_index: serviceIndex,
        service_deleted_at: null,
      },
    });
    if (!rawService) throw new NotFoundException('Service Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: rawService.service_parent_agent,
        agent_connection: 'linked',
        agent_deleted_at: null,
        parent: {
          workspace_owner: owner,
          workspace_deleted_at: null,
        },
      },
    });
    if (!rawAgent) throw new NotFoundException('Service Not Found.');

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

  async handleCreateService(
    owner: number,
    body: {
      workspaceIdx: number,
      serviceName: string;
      servicePort: number;
      serviceContainerPort?: number;
      serviceHostPort?: number;
      servicePortMappings?: ServicePortMapping[];
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
        service_parent_agent: body.agentIndex,
        service_name: body.serviceName,
        service_deleted_at: null,
        service_status: { not: 'removed' },
      },
      select: { service_index: true },
    });
    if (duplicatedService) throw new ConflictException('Service Name Already Exists on This Agent.');

    const sourceRepositories = this.normalizeSourceRepositories(body.serviceSourceUrl, body.serviceRootDirectory);
    const sourceUrlStored = this.serializeSourceRepositories(sourceRepositories);
    const hostPort = body.serviceHostPort ?? body.servicePort;
    const containerPort = body.serviceContainerPort ?? body.servicePort;
    const portMappings = this.normalizePortMappings(body.servicePortMappings, hostPort, containerPort);
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
        service_parent_agent: body.agentIndex,
      },
    });

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
    this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);

    return { serviceIndex: rawService.service_index, deleteScope: scope };
  }

  async handleRedeployService(
    owner: number,
    serviceIdx: string,
    body: {
      serviceName?: string;
      servicePort?: number;
      serviceContainerPort?: number;
      serviceHostPort?: number;
      servicePortMappings?: ServicePortMapping[];
      serviceSourceUrl?: ServiceSourceInput;
      serviceRootDirectory?: string;
      serviceVersion?: string;
      serviceDeployPreset?: DeployPreset;
      env?: Record<string, string>;
    },
  ) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);

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
    const primaryPortMapping = portMappings[0];
    const rootDirectory = sourceRepositories[0].rootDirectory;
    const env = body.env !== undefined
      ? this.normalizeEnv(body.env)
      : this.normalizeEnv(rawService.service_env);

    if (body.serviceName && body.serviceName !== rawService.service_name) {
      const duplicatedService = await this.prismaService.services.findFirst({
        where: {
          service_parent_agent: rawService.service_parent_agent,
          service_name: body.serviceName,
          service_deleted_at: null,
          service_status: { not: 'removed' },
          service_index: { not: rawService.service_index },
        },
        select: { service_index: true },
      });
      if (duplicatedService) throw new ConflictException('Service Name Already Exists on This Agent.');
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
        service_version: body.serviceVersion ?? rawService.service_version,
        service_deploy_preset: (body.serviceDeployPreset ?? rawService.service_deploy_preset) as any,
      },
    });

    const sent = this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'command', {
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
      this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return toCamelCase(updatedService);
  }

  async handleStartService(owner: number, serviceIdx: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service must be redeployed before it can be started.');
    }

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
      this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
      this.ensureCommandSent(sent);
    }

    this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
    return { serviceIndex: rawService.service_index };
  }

  async handleStopService(owner: number, serviceIdx: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service cannot be stopped.');
    }

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
      this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
      this.ensureCommandSent(sent);
    }

    this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
    return { serviceIndex: rawService.service_index };
  }

  async handleStartContainer(owner: number, serviceIdx: string, containerName: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service must be redeployed before containers can be started.');
    }

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
      this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return { serviceIndex: rawService.service_index, containerName };
  }

  async handleStopContainer(owner: number, serviceIdx: string, containerName: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service containers cannot be stopped.');
    }

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
      this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return { serviceIndex: rawService.service_index, containerName };
  }

  async handleRestartContainer(owner: number, serviceIdx: string, containerName: string) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);
    if (rawService.service_status === 'removed') {
      throw new ConflictException('Removed service must be redeployed before containers can be restarted.');
    }

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
      this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
      this.ensureCommandSent(sent);
    }

    return { serviceIndex: rawService.service_index, containerName };
  }

  async handleUpdateServiceSubdomain(owner: number, serviceIdx: string, subdomain: string | null) {
    const { rawService } = await this.findOwnedServiceAndAgent(owner, serviceIdx);

    if (subdomain !== null) {
      const duplicate = await this.prismaService.services.findFirst({
        where: {
          service_subdomain: subdomain,
          service_index: { not: rawService.service_index },
        },
      });
      if (duplicate) throw new ConflictException('Subdomain Already In Use.');
    }

    const updated = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: { service_subdomain: subdomain },
    });

    return {
      serviceIndex: updated.service_index,
      serviceSubdomain: updated.service_subdomain,
    };
  }

  async handleGetServiceList(owner: number, workspaceIdx: number) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: { workspace_index: workspaceIdx, workspace_owner: owner, workspace_deleted_at: null },
    });

    if (!workspace) throw new NotFoundException('Workspace Not Found.');

    const agents = await this.prismaService.agents.findMany({
      where: { agent_parent_workspace: workspaceIdx, agent_connection: 'linked', agent_deleted_at: null },
      select: { agent_index: true, agent_code: true, agent_name: true, agent_uuid: true },
    });

    const agentIndexes = agents.map(a => a.agent_index);

    const rawServices = await this.prismaService.services.findMany({
      where: { service_parent_agent: { in: agentIndexes }, service_deleted_at: null },
      orderBy: { service_created_at: 'desc' },
    });

    const agentMap = new Map(agents.map(a => [a.agent_index, a]));

    return rawServices.map(s => ({
      serviceIndex: s.service_index,
      serviceName: s.service_name,
      servicePort: s.service_port,
      serviceHostPort: s.service_host_port ?? s.service_port,
      serviceContainerPort: s.service_container_port ?? s.service_port,
      servicePortMappings: this.normalizePortMappings((s as any).service_port_mappings, s.service_host_port ?? s.service_port, s.service_container_port ?? s.service_port),
      serviceSourceUrl: s.service_source_url,
      serviceRootDirectory: s.service_root_directory,
      serviceEnv: this.normalizeEnv(s.service_env),
      serviceStatus: s.service_status,
      serviceSubdomain: s.service_subdomain,
      serviceVersion: s.service_version,
      serviceDeployPreset: s.service_deploy_preset,
      serviceCreatedAt: s.service_created_at,
      agentIndex: s.service_parent_agent,
      agentCode: agentMap.get(s.service_parent_agent)?.agent_code ?? null,
      agentName: agentMap.get(s.service_parent_agent)?.agent_name ?? null,
      agentUuid: agentMap.get(s.service_parent_agent)?.agent_uuid ?? null,
    }));
  }
}
