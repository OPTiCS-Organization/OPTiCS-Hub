import { Injectable, NotFoundException } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { generate } from 'random-words';
import log from 'spectra-log';

@Injectable()
export class AgentService {
  constructor (
    private readonly prismaService: PrismaService,
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

    return toCamelCase(rawUpdatedAgent);
  }

  async registerAgent(ip: string, existingCode?: string): Promise<string> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (existingCode) {
      const valid = await this.prismaService.agents.findFirst({
        where: {
          agent_code: existingCode,
          agent_created_at: { gte: since },
        },
      });
      if (valid) return valid.agent_code;
    }

    const byIp = await this.prismaService.agents.findFirst({
      where: {
        agent_ip: ip,
        agent_created_at: { gte: since },
      },
      orderBy: { agent_created_at: 'desc' },
    });

    if (byIp) return byIp.agent_code;

    const agentCode = `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`;

    await this.prismaService.agents.create({
      data: {
        agent_ip: ip,
        agent_code: agentCode,
        agent_connection: 'unlinked',
      },
    });

    return agentCode;
  }

  async markAgentOffline(socketId: string): Promise<void> {
    // socket.id는 DB에 없으므로 agent_last_online 기준으로 처리하거나
    // 필요 시 socket_id 컬럼 추가 후 조회 가능
    // 현재는 로그만 남김
    console.log(`Agent disconnected: ${socketId}`);
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

    return toCamelCase(rawUpdatedAgent);
  }
}
