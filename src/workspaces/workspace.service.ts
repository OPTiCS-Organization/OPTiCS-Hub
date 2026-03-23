import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import log from 'spectra-log';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prismaService: PrismaService,
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
        agent_code: targetAgentCode
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

    const agentUrl = `http://${rawUpdatedAgent.agent_ip}:5230`;
    await axios.post(`${agentUrl}/v1/notify/connect-request`, {
      workspaceOwnerName: workspaceOwnerName,
      workspaceName: rawWorkspace.workspace_name,
      workspaceCreatedAt: rawWorkspace.workspace_created_at,
      workspaceIndex: rawWorkspace.workspace_index,
      requestDatetime: new Date()
    });

    return toCamelCase(rawUpdatedAgent);
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
