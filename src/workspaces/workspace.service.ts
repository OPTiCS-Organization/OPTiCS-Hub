import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import log from 'spectra-log';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { AgentGateway } from 'src/agent/agent.gateway';
import { ConsoleGateway } from 'src/agent/console.gateway';
import { DeployPreset } from '@prisma/client';

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
      },
      data: {
        agent_connection: 'requested',
        agent_parent_workspace: targetWorkspaceIdx
      },
      where: {
        agent_code: targetAgentCode
      }
    });

    this.agentGateway.sendToAgent(targetAgentCode, 'connect-request', {
      workspaceOwnerName,
      workspaceName: rawWorkspace.workspace_name,
      workspaceCreatedAt: rawWorkspace.workspace_created_at,
      workspaceIndex: rawWorkspace.workspace_index,
      requestDatetime: new Date(),
    });

    return toCamelCase(rawUpdatedAgent);
  }

  async handleCreateService(
    owner: number,
    body: {
      workspaceIdx: number,
      serviceName: string;
      servicePort: number;
      serviceSourceUrl: string;
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
      where: { agent_index: body.agentIndex, agent_parent_workspace: body.workspaceIdx, agent_connection: 'linked', agent_deleted_at: null },
    });
    if (!agent) throw new NotFoundException('Agent Not Found.');

    const raw = await this.prismaService.services.create({
      data: {
        service_name: body.serviceName,
        service_port: body.servicePort,
        service_source_url: body.serviceSourceUrl,
        service_version: body.serviceVersion,
        service_deploy_preset: body.serviceDeployPreset as any,
        service_parent_agent: body.agentIndex,
      },
    });

    this.agentGateway.sendToAgent(agent.agent_code, 'command', {
      command: 'DEPLOY',
      serviceIndex: raw.service_index,
      sourceUrl: body.serviceSourceUrl,
      deployPreset: body.serviceDeployPreset,
      serviceName: body.serviceName,
      servicePort: body.servicePort,
      serviceVersion: body.serviceVersion,
      env: body.env ?? {},
    });

    this.consoleGateway.notifyAgentUpdated();
    return toCamelCase(raw);
  }

  async handleDeleteService(serviceIdx: string) {
    const rawService = await this.prismaService.services.findFirst({
      where: { service_index: parseInt(serviceIdx), service_deleted_at: null },
    });
    if (!rawService) throw new NotFoundException('Service Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({
      where: { agent_index: rawService.service_parent_agent, agent_connection: 'linked', agent_deleted_at: null },
    });
    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: { service_deleted_at: new Date() },
    });

    this.agentGateway.sendToAgent(rawAgent.agent_code, 'command', {
      command: 'DELETE',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
    });

    return { serviceIndex: rawService.service_index };
  }

  async handleRedeployService(
    serviceIdx: string,
    body: {
      serviceName?: string;
      servicePort?: number;
      serviceSourceUrl?: string;
      serviceVersion?: string;
      serviceDeployPreset?: DeployPreset;
      env?: Record<string, string>;
    },
  ) {
    const rawService = await this.prismaService.services.findFirst({
      where: { service_index: parseInt(serviceIdx), service_deleted_at: null },
    });
    if (!rawService) throw new NotFoundException('Service Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({
      where: { agent_index: rawService.service_parent_agent, agent_connection: 'linked', agent_deleted_at: null },
    });
    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    const updatedService = await this.prismaService.services.update({
      where: { service_index: rawService.service_index },
      data: {
        service_name: body.serviceName ?? rawService.service_name,
        service_port: body.servicePort ?? rawService.service_port,
        service_source_url: body.serviceSourceUrl ?? rawService.service_source_url,
        service_version: body.serviceVersion ?? rawService.service_version,
        service_deploy_preset: (body.serviceDeployPreset ?? rawService.service_deploy_preset) as any,
      },
    });

    this.agentGateway.sendToAgent(rawAgent.agent_code, 'command', {
      command: 'REDEPLOY',
      serviceIndex: updatedService.service_index,
      sourceUrl: updatedService.service_source_url,
      deployPreset: updatedService.service_deploy_preset,
      serviceName: updatedService.service_name,
      servicePort: updatedService.service_port,
      serviceVersion: updatedService.service_version,
      env: body.env ?? {},
    });

    return toCamelCase(updatedService);
  }

  async handleStartService(serviceIdx: string) {
    const rawService = await this.prismaService.services.findFirst({
      where: {
        service_index: parseInt(serviceIdx),
        service_deleted_at: null,
      }
    });
    if (!rawService) throw new NotFoundException('Service Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: rawService.service_parent_agent,
        agent_connection: 'linked',
        agent_deleted_at: null,
      }
    });
    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    this.agentGateway.sendToAgent(rawAgent.agent_code, 'command', {
      command: 'START',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      servicePort: rawService.service_port,
      serviceVersion: rawService.service_version,
    });

    this.consoleGateway.notifyAgentUpdated();
    return { serviceIndex: rawService.service_index };
  }

  async handleStopService(serviceIdx: string) {
    const rawService = await this.prismaService.services.findFirst({
      where: {
        service_index: parseInt(serviceIdx),
        service_deleted_at: null,
      }
    });
    if (!rawService) throw new NotFoundException('Service Not Found.');

    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: rawService.service_parent_agent,
        agent_connection: 'linked',
        agent_deleted_at: null,
      }
    });
    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    this.agentGateway.sendToAgent(rawAgent.agent_code, 'command', {
      command: 'STOP',
      serviceIndex: rawService.service_index,
      serviceName: rawService.service_name,
      servicePort: rawService.service_port,
      serviceVersion: rawService.service_version,
    });

    this.consoleGateway.notifyAgentUpdated();
    return { serviceIndex: rawService.service_index };
  }

  async handleGetServiceList(owner: number, workspaceIdx: number) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: { workspace_index: workspaceIdx, workspace_owner: owner, workspace_deleted_at: null },
    });

    if (!workspace) throw new NotFoundException('Workspace Not Found.');

    const agents = await this.prismaService.agents.findMany({
      where: { agent_parent_workspace: workspaceIdx, agent_connection: 'linked', agent_deleted_at: null },
      select: { agent_index: true, agent_code: true },
    });

    const agentIndexes = agents.map(a => a.agent_index);

    const rawServices = await this.prismaService.services.findMany({
      where: { service_parent_agent: { in: agentIndexes }, service_deleted_at: null },
      orderBy: { service_created_at: 'desc' },
    });

    const agentCodeMap = new Map(agents.map(a => [a.agent_index, a.agent_code]));

    return rawServices.map(s => ({
      serviceIndex: s.service_index,
      serviceName: s.service_name,
      servicePort: s.service_port,
      serviceSourceUrl: s.service_source_url,
      serviceStatus: s.service_status,
      serviceVersion: s.service_version,
      serviceDeployPreset: s.service_deploy_preset,
      serviceCreatedAt: s.service_created_at,
      agentIndex: s.service_parent_agent,
      agentCode: agentCodeMap.get(s.service_parent_agent) ?? null,
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
