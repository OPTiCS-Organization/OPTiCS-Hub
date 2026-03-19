import { Injectable, NotFoundException } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class AgentService {
  constructor (
    private readonly prismaService: PrismaService,
  ) { };

  async handleAcceptConnectRequest(agentCode: string) {
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

    return toCamelCase(rawUpdatedAgent);
  }

  async handleRejectConnectRequest(agentCode: string) {
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

    return toCamelCase(rawUpdatedAgent);
  }
}
