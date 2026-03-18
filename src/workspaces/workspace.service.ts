import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import ms from 'ms';
import { generate } from 'random-words';
import log from 'spectra-log';
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

    if (connection) return connection.agent_token;

    const newConnection = await this.prismaService.agents.create({
      data: {
        agent_ip: ip,
        agent_token: `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`,
      }
    });

    return newConnection.agent_token;
  }

  async handleCreateWorkspace(owner: number, workspaceName: string | undefined) {
    const newWorkspace = await this.prismaService.workspaces.create({
      data: {
        workspace_owner: owner,
        workspace_name: workspaceName ?? 'Unnamed Workspace',
      }
    });

    return newWorkspace;
  }

  async handleConnectWorkspace(owner: number, targetWorkspaceIdx: number, targetAgentCode: string) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_owner: owner,
        workspace_index: targetWorkspaceIdx,
      },
    });

    if (!workspace) throw new NotFoundException('Workspace Not Found.');
    if (workspace.agent_token) throw new ConflictException('This Agent has Already Linked With Another Workspace.');

    workspace.agent_token = targetAgentCode;
    workspace.workspace_status = 'linked';

    return await this.prismaService.$transaction([
      this.prismaService.workspaces.update({
        where: {
          workspace_owner: owner,
          workspace_index: targetWorkspaceIdx,
        },
        data: {
          agent_token: targetAgentCode,
          workspace_status: 'linked',
        }
      }),
      this.prismaService.agents.update({
        where: {
          agent_token: targetAgentCode,
        },
        data: {
          agent_established: true,
        }
      }),
    ])[0];

  }
}
