import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { generate } from 'random-words';
import log from 'spectra-log';
import { ConsoleGateway } from './console.gateway';
import { ReleaseCatalogService } from 'src/releases/release-catalog.service';
import { supportsRemoteUpdate } from 'src/global/agent-capability';
import * as crypto from 'crypto';
import { Agent } from './types/Agent.type';


@Injectable()
export class AgentService implements OnModuleInit {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly consoleGateway: ConsoleGateway,
    private readonly releaseCatalogService: ReleaseCatalogService,
  ) { };

  async onModuleInit() {
    await this.prismaService.agents.updateMany({
      where: { agent_deleted_at: null },
      data: { agent_status: 'offline', agent_last_online: new Date() },
    });
  }

  async handleAcceptConnectRequest(agentCode: string, agentUuid: string) {
    log('Accept')
    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: agentCode.toUpperCase(),
        agent_uuid: agentUuid,
        agent_connection: 'requested',
      }
    });

    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: agentCode.toUpperCase(),
        agent_uuid: agentUuid,
        agent_connection: 'requested',
      },
      data: {
        agent_connection: 'linked',
      }
    })

    this.consoleGateway.notifyWorkspaceUpdated(rawUpdatedAgent.agent_parent_workspace);
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
  public async registerAgent(ip: string, agentUuid: string | null, agentVersion: string, protocolVersion: number, signature: string | null): Promise<{ ip: string, code: string, uuid: string, signingSecret: string | null, parentWorkspace: number | null }> {
    /**
     * uuid 값이 NULL인가? => 새 에이전트 생성
     *                    아니면 UUID로 기존 에이전트 검색
     */

    /**
     * Case
     * UUID is EXISTS
     * UUID is NULL
     * UUID is EXIST but doesn't exist on DB
     */
    const agent: Agent = {
      code: null,
      parentWorkspace: null,
      ip: ip,
      uuid: agentUuid,
      signingSecret: signature,
      protocolVersion: protocolVersion,
    };

    if (agent.uuid) { // UUID가 있으면
      const exist = await this.prismaService.agents.findFirst({
        where: {
          agent_uuid: agent.uuid,
        },
        select: {
          agent_code: true,
          agent_uuid: true,
          agent_parent_workspace: true,
          agent_signing_secret: true,
        }
      });

      if (exist) { // 일치하는 UUID를 찾으면
        /**
         * 서명 비밀이 비어 있다면 HMAC 도입 이전에 등록된 Agent다. 이번 등록에서 발급해 준다.
         *
         * 이 경로가 없으면 기존 Agent는 영영 비밀을 갖지 못하고, Hub가 서명 검증을
         * 강제하는 순간 전부 접속 불가가 된다. 이미 있는 비밀은 절대 덮어쓰지 않는다.
         * 재발급은 곧 그 Agent의 신원 교체이고, 경합하는 두 소켓이 서로의 비밀을
         * 무효화하는 상황을 만든다.
         */
        const reissuedSecret = exist.agent_signing_secret ? null : crypto.randomBytes(32).toString('hex');

        const updatedAgent = await this.prismaService.agents.update({
          where: {
            agent_uuid: agent.uuid
          },
          data: {
            agent_status: 'online',
            agent_ip: ip,
            agent_last_online: new Date(),
            agent_protocol_version: protocolVersion,
            agent_version: agentVersion,
            ...(reissuedSecret ? { agent_signing_secret: reissuedSecret } : {}),
          },
        });
        agent.code = updatedAgent.agent_code;
        agent.uuid = updatedAgent.agent_uuid;
        agent.parentWorkspace = updatedAgent.agent_parent_workspace;

        return {
          // 이미 비밀을 가진 Agent에게는 null을 보낸다. Agent는 null이면 저장본을 유지한다.
          signingSecret: reissuedSecret,
          ip: agent.ip,
          code: agent.code,
          uuid: agent.uuid,
          parentWorkspace: agent.parentWorkspace,
        };
      }
    }
    // UUID가 NULL이거나 일치하는 UUID를 찾지 못 했을 때
    const newCode = `${generate({ exactly: 1, join: '' })}-${generate({ exactly: 1, join: '' })}`.toUpperCase();
    const newSecret = crypto.randomBytes(32).toString('hex');
    const newAgent = await this.prismaService.agents.create({
      data: {
        agent_ip: ip,
        agent_code: newCode,
        agent_name: newCode,
        agent_signing_secret: newSecret,
        agent_protocol_version: agent.protocolVersion,
        agent_connection: 'unlinked',
        agent_status: 'online',
        agent_version: agentVersion,
      },
    });

    return {
      ip: newAgent.agent_ip,
      code: newAgent.agent_code,
      uuid: newAgent.agent_uuid,
      signingSecret: newAgent.agent_signing_secret,
      parentWorkspace: newAgent.agent_parent_workspace,
    }
  }

  /**
   * Agent의 HMAC 서명 비밀을 조회한다. 아직 발급되지 않았으면 null.
   *
   * register는 소켓에 비밀을 붙이기 전에 도착하므로, 그 한 건만 DB에서 직접 읽어
   * 검증해야 한다. 등록 이후의 이벤트는 client.data에 붙여둔 값을 쓴다.
   */
  public async getSigningSecret(agentUuid: string): Promise<string | null> {
    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: { agent_signing_secret: true },
    });
    return agent?.agent_signing_secret ?? null;
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

    // 카탈로그는 Agent마다 다시 읽을 필요가 없다. 한 번 조회해 전부에 적용한다.
    const upgrades = new Map<string, { version: string; notes: string | null } | null>();
    for (const version of new Set(rawAgents.map((a) => a.agent_version))) {
      const upgrade = await this.releaseCatalogService
        .findUpgradeFor(version)
        .catch(() => null);
      upgrades.set(version ?? '', upgrade ? { version: upgrade.version, notes: upgrade.notes } : null);
    }

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
      agentUuid: a.agent_uuid,
      agentVersion: a.agent_version,
      updatePhase: a.agent_update_phase,
      updateTarget: a.agent_update_target,
      updateMessage: a.agent_update_message,
      updateStartedAt: a.agent_update_started_at,
      upgrade: upgrades.get(a.agent_version ?? '') ?? null,
      remoteUpdateSupported: supportsRemoteUpdate(a.agent_version),
    }));
  }

  async updateServiceStatus(serviceIndex: number, status: string): Promise<void> {
    await this.prismaService.services.update({
      where: { service_index: serviceIndex },
      data: { service_status: status as any },
    });
  }

  async markAgentOffline(agentUuid: string): Promise<void> {
    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: { agent_parent_workspace: true },
    });
    const updateOffline = () => this.prismaService.agents.updateMany({
      where: { agent_uuid: agentUuid },
      data: { agent_status: 'offline', agent_last_online: new Date() },
    });
    try {
      await updateOffline();
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        await updateOffline();
      } catch (error) {
        log(`[Agent Service] Failed to mark agent offline: ${agentUuid}`, 500, 'ERROR');
        log(error);
      }
    }
    this.consoleGateway.notifyWorkspaceUpdated(agent?.agent_parent_workspace ?? null);
  }

  async handleRejectConnectRequest(agentCode: string, agentUuid: string) {
    log('Rejecting')
    const rawAgent = await this.prismaService.agents.findFirst({
      where: {
        agent_code: agentCode.toUpperCase(),
        agent_uuid: agentUuid,
        agent_connection: 'requested',
      }
    });

    if (!rawAgent) throw new NotFoundException('Agent Not Found.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: agentCode.toUpperCase(),
        agent_uuid: agentUuid,
        agent_connection: 'requested',
      },
      data: {
        agent_connection: 'unlinked',
        agent_parent_workspace: null,
      }
    })

    this.consoleGateway.notifyWorkspaceUpdated(rawAgent.agent_parent_workspace);
    return toCamelCase(rawUpdatedAgent);
  }
}
