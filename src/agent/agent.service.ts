import { Injectable, NotFoundException } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { generate } from 'random-words';
import log from 'spectra-log';
import { ConsoleGateway } from './console.gateway';

@Injectable()
export class AgentService {
  constructor(
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

  /**
   * 
   * @param ip 
   * @param agentUuid 
   * @returns 
   * 
   * 에이전트에서 이미 존재하는 UUID가 있다면 보내주고, 없으면 Null을 전달해 줌
   * 데이터베이스에서 일치하는 UUID를 찾으면 IP가 같은지 검사
   *    ㄴ 같다면 같은 IP
   *    ㄴ 다르다면 IP 업데이트
   * 일치하는 UUID를 찾지 못하면 새 에이전트 생성 후 응답
   */
  public async registerAgent(ip: string, agentUuid: string | null): Promise<{ agentCode: string, agentUuid: string }> {
    const agent: { agentCode: string | undefined, agentUuid: string | undefined } = { agentCode: undefined, agentUuid: undefined };
    if (agentUuid) { // UUID가 있으면
      const exist = await this.prismaService.agents.findFirst({
        where: {
          agent_uuid: agentUuid,
        },
        select: {
          agent_code: true,
          agent_uuid: true,
        }
      })
      if (exist) { // 일치하는 UUID를 찾으면
        const updatedAgent = await this.prismaService.agents.update({
          where: {
            agent_uuid: agentUuid
          },
          data: {
            agent_status: 'online',
            agent_ip: ip
          },
        });
        agent.agentCode = updatedAgent.agent_code;
        agent.agentUuid = updatedAgent.agent_uuid;
      } else { // 일치하는 UUID를 찾지 못하면
        const newCode = `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`.toUpperCase();
        const newAgent = await this.prismaService.agents.create({
          data: {
            agent_ip: ip,
            agent_code: newCode,
            agent_name: newCode,
            agent_connection: 'unlinked',
            agent_status: 'online',
          },
        });
        agent.agentCode = newAgent.agent_code;
        agent.agentUuid = newAgent.agent_uuid;
      }
    } else { // UUID가 NULL이면
      const newCode = `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`.toUpperCase();
      const newAgent = await this.prismaService.agents.create({
        data: {
          agent_ip: ip,
          agent_code: newCode,
          agent_name: newCode,
          agent_connection: 'unlinked',
          agent_status: 'online',
        },
      });
      agent.agentCode = newAgent.agent_code;
      agent.agentUuid = newAgent.agent_uuid;
    }
    return { agentCode: agent.agentCode, agentUuid: agent.agentUuid };
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
      agentName: a.agent_name,
      agentConnection: a.agent_connection,
      agentStatus: a.agent_status,
      agentCreatedAt: a.agent_created_at,
      agentLastOnline: a.agent_last_online,
      workspaceName: a.parent?.workspace_name ?? null,
      agentUuid: a.agent_uuid
    }));
  }

  async updateServiceStatus(serviceIndex: number, status: string): Promise<void> {
    await this.prismaService.services.update({
      where: { service_index: serviceIndex },
      data: { service_status: status as any },
    });
  }

  async markAgentOffline(agentUuid: string): Promise<void> {
    await this.prismaService.agents.updateMany({
      where: { agent_uuid: agentUuid },
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
