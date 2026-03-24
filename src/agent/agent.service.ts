import { Injectable, NotFoundException } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { generate } from 'random-words';
import log from 'spectra-log';
import { ConsoleGateway } from './console.gateway';

@Injectable()
export class AgentService {
  constructor (
    private readonly prismaService: PrismaService,
    private readonly consoleGateway: ConsoleGateway,
  ) { };

  async handleAcceptConnectRequest(agentCode: string) {
    log('Accept')
    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: agentCode,
        agent_connection: 'requested',
      }
    });

    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: agentCode,
        agent_connection: 'requested',
      },
      data: {
        agent_connection: 'linked',
      }
    })

    this.consoleGateway.notifyAgentUpdated();
    return toCamelCase(rawUpdatedAgent);
  }

  async registerAgent(ip: string, existingCode?: string): Promise<string> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (existingCode) {
      const valid = await this.prismaService.agents.findFirst({
        where: {
          agent_code: existingCode.toUpperCase(),
          agent_created_at: { gte: since },
        },
      });
      if (valid) {
      await this.prismaService.agents.update({
        where: { agent_code: valid.agent_code },
        data: { agent_status: 'online' },
      });
      return valid.agent_code;
    }
    }

    const byIp = await this.prismaService.agents.findFirst({
      where: {
        agent_ip: ip,
        agent_created_at: { gte: since },
      },
      orderBy: { agent_created_at: 'desc' },
    });

    if (byIp) {
      await this.prismaService.agents.update({
        where: { agent_code: byIp.agent_code },
        data: { agent_status: 'online' },
      });
      return byIp.agent_code;
    }

    const agentCode = `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`.toUpperCase();

    await this.prismaService.agents.create({
      data: {
        agent_ip: ip,
        agent_code: agentCode,
        agent_connection: 'unlinked',
        agent_status: 'online',
      },
    });

    return agentCode;
  }

  async getAgentList(userIndex: number, workspaceIdx: number) {
    const rawAgents = await this.prismaService.agents.findMany({
      where: {
        agent_deleted_at: null,
        agent_connection: { in: ['requested', 'linked'] },
        parent: {
          workspace_index: workspaceIdx,
          workspace_owner: userIndex,
          workspace_deleted_at: null,
        },
      },
      orderBy: { agent_created_at: 'desc' },
      include: {
        parent: { select: { workspace_name: true } },
      },
    });

    return rawAgents.map((a) => ({
      agentIndex: a.agent_index,
      agentIp: a.agent_connection === 'linked' ? a.agent_ip : null,
      agentCode: a.agent_code,
      agentConnection: a.agent_connection,
      agentStatus: a.agent_status,
      agentCreatedAt: a.agent_created_at,
      agentLastOnline: a.agent_last_online,
      workspaceName: a.parent?.workspace_name ?? null,
    }));
  }

  async markAgentOffline(agentCode: string): Promise<void> {
    await this.prismaService.agents.updateMany({
      where: { agent_code: agentCode.toUpperCase() },
      data: { agent_status: 'offline', agent_last_online: new Date() },
    });
    this.consoleGateway.notifyAgentUpdated();
  }

  async handleRejectConnectRequest(agentCode: string) {
    log('Rejecting')
    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: agentCode,
        agent_connection: 'requested',
      }
    });

    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: agentCode,
        agent_connection: 'requested',
      },
      data: {
        agent_connection: 'unlinked',
        agent_parent_workspace: null,
      }
    })

    this.consoleGateway.notifyAgentUpdated();
    return toCamelCase(rawUpdatedAgent);
  }
}
