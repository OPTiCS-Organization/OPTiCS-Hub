import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import ms from 'ms';
import { generate } from 'random-words';
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

  async handleInitializeServer(data, ip) {
    const connection = await this.prismaService.agents.findFirst({
      where: {
        agent_ip: ip,
        agent_deleted_at: null,
        agent_created_at: {
          gte: new Date(Date.now() - ms('1d')),
        }
      }
    });

    if (connection) return connection.agent_code;

    const newConnection = await this.prismaService.agents.create({
      data: {
        agent_ip: ip,
        agent_code: `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`,
      }
    });

    return newConnection.agent_code;
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
      },
      where: {
        workspace_owner: owner
      }
    });

    return toCamelCase(rawWorkspaceList);
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

  async requestConnectWorkspaceAndAgent(workspaceOwner: number, targetWorkspaceIdx: number, targetAgentCode: string) {
    const rawWorkspace = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_owner: workspaceOwner,
        workspace_index: targetWorkspaceIdx,
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
      },
      data: {
        agent_connection: 'requested',
        agent_parent_workspace: targetWorkspaceIdx
      },
      where: {
        agent_code: targetAgentCode
      }
    });

    return toCamelCase(rawUpdatedAgent);
  }

  async handleGetWorkspaceInformation(owner: number, targetWorkspaceName: string) {
    const data = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_owner: owner,
        workspace_name: targetWorkspaceName
      }
    });
    return data;
  }
}
