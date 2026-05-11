import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import log from 'spectra-log';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { AgentGateway } from 'src/agent/agent.gateway';
import { ConsoleGateway } from 'src/agent/console.gateway';
import { DeployPreset, Prisma } from '@prisma/client';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
    private readonly consoleGateway: ConsoleGateway,
  ) { };

  handleHeartbeat(data) {
    log(data);
  }

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

  async handleCreateWorkspace(owner: number, workspaceName: string | undefined) {
    if (workspaceName === undefined) {
      const count = await this.prismaService.workspaces.count({
        where: { workspace_owner: owner }
      });
      workspaceName = `Unnamed Workspace ${count + 1}`;
    }

    const rawWorkspace = await this.prismaService.workspaces.create({
      select: {
        workspace_index: true,
        workspace_name: true,
        workspace_created_at: true
      },
      data: {
        workspace_owner: owner,
        workspace_name: workspaceName,
      }
    });

    return toCamelCase(rawWorkspace);
  }

  async handleValidateWorkspace(owner: number, workspaceName: string) {
    if (!workspaceName.trim()) return false;
    if (await this.prismaService.workspaces.findFirst({ where: { workspace_name: workspaceName, workspace_deleted_at: null } })) return false;
    else return true;
  }

  async handleGetWorkspaceList(owner: number) {
    const rawWorkspaceList = await this.prismaService.workspaces.findMany({
      select: {
        workspace_name: true,
        workspace_index: true,
        agents: {
          select: {
            agent_connection: true,
            agent_last_online: true,
          },
          where: {
            agent_connection: 'linked',
          },
          orderBy: { agent_last_online: 'desc' },
          take: 1,
        },
      },
      where: {
        workspace_owner: owner,
        workspace_deleted_at: null,
      }
    });

    const workspaceList = rawWorkspaceList.map(w => ({
      workspaceIndex: w.workspace_index,
      workspaceName: w.workspace_name,
      status: w.agents.length > 0 ? 'linked' : 'unlinked',
      lastOnline: w.agents[0]?.agent_last_online ?? null,
    }));

    return workspaceList;
  }

  async handleDeleteWorkspace(owner: number, workspaceIdx) {
    const workspaceData = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_index: workspaceIdx,
        workspace_owner: owner,
        workspace_deleted_at: null
      }
    });

    if (!workspaceData) throw new NotFoundException('Workspace Not Found');

    const workspaceDeleteTimestamp = new Date();

    await this.prismaService.workspaces.update({
      where: {
        workspace_index: workspaceIdx,
        workspace_owner: owner,
        workspace_deleted_at: null
      },
      data: {
        workspace_deleted_at: workspaceDeleteTimestamp,
      },
      select: {
        workspace_deleted_at: true,
      }
    });

    return { workspaceDeletedAt: workspaceDeleteTimestamp };
  }

  async requestConnectWorkspaceAndAgent(workspaceOwner: number, targetWorkspaceIdx: number, targetAgentCode: string, workspaceOwnerName: string) {
    const rawWorkspace = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_owner: workspaceOwner,
        workspace_index: targetWorkspaceIdx,
        workspace_deleted_at: null,
      },
    });

    if (!rawWorkspace) throw new NotFoundException('Workspace Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: targetAgentCode.toUpperCase()
      }
    });

    if (!rawAgent) throw new NotFoundException('Matching Agent Not Found.');
    if (rawAgent.agent_connection === 'requested') throw new ConflictException('This Agent Already Have Connection Request From Another Workspace.');
    if (rawAgent.agent_connection === 'linked') throw new GoneException('This Agent have valid Connection with Another Workspace.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      select: {
        agent_connection: true,
        agent_parent_workspace: true,
        agent_ip: true,
        agent_uuid: true,
      },
      data: {
        agent_connection: 'requested',
        agent_parent_workspace: targetWorkspaceIdx
      },
      where: {
        agent_code: rawAgent.agent_code
      }
    });

    const sent = this.agentGateway.sendToAgent(rawUpdatedAgent.agent_uuid, 'connect-request', {
      workspaceOwnerName,
      workspaceName: rawWorkspace.workspace_name,
      workspaceCreatedAt: rawWorkspace.workspace_created_at,
      workspaceIndex: rawWorkspace.workspace_index,
      requestDatetime: new Date(),
    });
    if (!sent) {
      await this.prismaService.agents.update({
        where: { agent_code: rawAgent.agent_code },
        data: {
          agent_connection: 'unlinked',
          agent_parent_workspace: null,
        },
      });
      this.consoleGateway.notifyWorkspaceUpdated(targetWorkspaceIdx);
      throw new ServiceUnavailableException('Agent is not connected.');
    }

    return toCamelCase(rawUpdatedAgent);
  }

  async disconnectWorkspaceAgent(workspaceOwner: number, targetWorkspaceIdx: number, targetAgentCode: string) {
    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: targetAgentCode.toUpperCase(),
        agent_parent_workspace: targetWorkspaceIdx,
        agent_deleted_at: null,
        parent: {
          workspace_owner: workspaceOwner,
          workspace_deleted_at: null,
        },
      },
    });

    if (!rawAgent) throw new NotFoundException('Agent Not Found.');
    if (rawAgent.agent_connection !== 'linked') throw new BadRequestException('Agent is not linked.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: rawAgent.agent_code,
      },
      data: {
        agent_connection: 'unlinked',
        agent_parent_workspace: null,
        agent_status: 'offline',
        agent_last_online: new Date(),
      },
    });

    this.agentGateway.disconnectAgent(rawAgent.agent_uuid);
    this.consoleGateway.notifyWorkspaceUpdated(targetWorkspaceIdx);

    return toCamelCase(rawUpdatedAgent);
  }

  async cancelWorkspaceAgentConnectionRequest(workspaceOwner: number, targetWorkspaceIdx: number, targetAgentCode: string) {
    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: targetAgentCode.toUpperCase(),
        agent_parent_workspace: targetWorkspaceIdx,
        agent_deleted_at: null,
        parent: {
          workspace_owner: workspaceOwner,
          workspace_deleted_at: null,
        },
      },
    });

    if (!rawAgent) throw new NotFoundException('Agent Not Found.');
    if (rawAgent.agent_connection !== 'requested') throw new BadRequestException('Agent connection is not requested.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: rawAgent.agent_code,
      },
      data: {
        agent_connection: 'unlinked',
        agent_parent_workspace: null,
      },
    });

    this.agentGateway.sendToAgent(rawAgent.agent_uuid, 'connect-request-cancelled', {
      workspaceIndex: targetWorkspaceIdx,
      requestCancelledAt: new Date(),
    });
    this.consoleGateway.notifyWorkspaceUpdated(targetWorkspaceIdx);

    return toCamelCase(rawUpdatedAgent);
  }

  async handleCreateService(
    owner: number,
    body: {
      workspaceIdx: number,
      serviceName: string;
      servicePort: number;
      serviceContainerPort?: number;
      serviceHostPort?: number;
      serviceSourceUrl: string | string[];
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

    const sourceUrlStored = Array.isArray(body.serviceSourceUrl)
      ? JSON.stringify(body.serviceSourceUrl)
      : body.serviceSourceUrl;
    const hostPort = body.serviceHostPort ?? body.servicePort;
    const containerPort = body.serviceContainerPort ?? body.servicePort;
    const rootDirectory = body.serviceRootDirectory?.trim() || null;
    const env = this.normalizeEnv(body.env);

    const raw = await this.prismaService.services.create({
      data: {
        service_name: body.serviceName,
        service_port: hostPort,
        service_host_port: hostPort,
        service_container_port: containerPort,
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
      sourceUrl: body.serviceSourceUrl,
      rootDirectory,
      deployPreset: body.serviceDeployPreset,
      serviceName: body.serviceName,
      servicePort: hostPort,
      serviceHostPort: hostPort,
      serviceContainerPort: containerPort,
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
      serviceSourceUrl?: string | string[];
      serviceRootDirectory?: string;
      serviceVersion?: string;
      serviceDeployPreset?: DeployPreset;
      env?: Record<string, string>;
    },
  ) {
    const { rawService, rawAgent } = await this.findOwnedServiceAndAgent(owner, serviceIdx);

    const newSourceUrl = body.serviceSourceUrl ?? rawService.service_source_url;
    const sourceUrlStored = Array.isArray(newSourceUrl) ? JSON.stringify(newSourceUrl) : newSourceUrl;
    const sourceUrlForAgent = (() => {
      try {
        return JSON.parse(sourceUrlStored) as string | string[];
      } catch {
        return sourceUrlStored;
      }
    })();
    const hostPort = body.serviceHostPort ?? body.servicePort ?? rawService.service_host_port ?? rawService.service_port;
    const containerPort = body.serviceContainerPort ?? body.servicePort ?? rawService.service_container_port ?? rawService.service_port;
    const rootDirectory = body.serviceRootDirectory !== undefined
      ? (body.serviceRootDirectory.trim() || null)
      : rawService.service_root_directory;
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
        service_port: hostPort,
        service_host_port: hostPort,
        service_container_port: containerPort,
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
      serviceSourceUrl: s.service_source_url,
      serviceRootDirectory: s.service_root_directory,
      serviceEnv: this.normalizeEnv(s.service_env),
      serviceStatus: s.service_status,
      serviceVersion: s.service_version,
      serviceDeployPreset: s.service_deploy_preset,
      serviceCreatedAt: s.service_created_at,
      agentIndex: s.service_parent_agent,
      agentCode: agentMap.get(s.service_parent_agent)?.agent_code ?? null,
      agentName: agentMap.get(s.service_parent_agent)?.agent_name ?? null,
      agentUuid: agentMap.get(s.service_parent_agent)?.agent_uuid ?? null,
    }));
  }

  async handleGetWorkspaceInformation(owner: number, targetWorkspaceName: string) {
    const rawWorkspaceData = await this.prismaService.workspaces.findFirst({
      select: {
        workspace_index: true,
        workspace_name: true,
        workspace_created_at: true,
      },
      where: {
        workspace_owner: owner,
        workspace_name: targetWorkspaceName,
        workspace_deleted_at: null
      }
    });

    if (!rawWorkspaceData) throw new NotFoundException('Target Workspace Not Found.');

    const rawConnectedAgents = await this.prismaService.agents.findMany({
      select: {
        agent_code: true,
        agent_connection: true,
        agent_status: true,
        agent_last_online: true,
      },
      where: {
        agent_connection: 'linked',
        agent_parent_workspace: rawWorkspaceData.workspace_index,
      }
    })

    const response = {
      workspaceIndex: rawWorkspaceData.workspace_index,
      workspaceName: rawWorkspaceData.workspace_name,
      workspaceCreatedAt: rawWorkspaceData.workspace_created_at,
      agents: rawConnectedAgents
    }

    return toCamelCase(response);
  }
}
