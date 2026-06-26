import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import log from 'spectra-log';
import { toCamelCase } from 'src/global/utils/toCamelCase';
import { PrismaService } from 'src/prisma.service';
import { AgentGateway } from 'src/agent/agent.gateway';
import { ConsoleGateway } from 'src/agent/console.gateway';
import { CloudflareDnsUtility } from 'src/utility/cloudflare.util';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WorkspaceService {
  /** 활성화 가능한 워크스페이스 서브도메인 최대 개수 */
  private readonly SUBDOMAIN_ACTIVE_LIMIT: number = 0;
  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
    private readonly consoleGateway: ConsoleGateway,
    private readonly cloudflareDnsUtility: CloudflareDnsUtility,
    private readonly configService: ConfigService,
  ) {
    this.SUBDOMAIN_ACTIVE_LIMIT = configService.getOrThrow<number>("SUBDOMAIN_ACTIVE_LIMIT");
  };

  handleHeartbeat(data) {
    log(data);
  }

  /** 전체 사용자 기준 현재 활성화된 서브도메인 개수 */
  private async countActiveSubdomains() {
    return this.prismaService.workspaces.count({
      where: { workspace_subdomain_active: true, workspace_deleted_at: null },
    });
  }

  /** 동일 서브도메인이 이미 활성화되어 사용 중인지 (자기 자신 제외) */
  private async isSubdomainTaken(subdomain: string, excludeWorkspaceIdx?: number) {
    const conflict = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_subdomain: subdomain,
        workspace_subdomain_active: true,
        workspace_deleted_at: null,
        workspace_index: excludeWorkspaceIdx ? { not: excludeWorkspaceIdx } : undefined,
      },
      select: { workspace_index: true },
    });
    return conflict !== null;
  }

  async handleCreateWorkspace(owner: number, workspaceName: string | undefined, workspaceSubdomain?: string | null) {
    if (workspaceName === undefined) {
      const count = await this.prismaService.workspaces.count({
        where: { workspace_owner: owner }
      });
      workspaceName = `Unnamed Workspace ${count + 1}`;
    }

    /**
     * 생성 조건
     * 한 소유자가 같은 이름의 워크스페이스를 2개 이상 만들 수 없음.
     * 서브도메인이 NULL일 수 있음.
     * 서브도메인이 입력되면 사용 가능(활성 한도 미초과 + 중복 없음)할 때만 활성화하고 DNS 레코드를 생성.
     * 사용할 수 없으면 값은 저장하되 비활성화 상태로 생성하고, 추후 다시 활성화할 수 있음.
     */
    const subdomain = workspaceSubdomain ?? null;
    let dnsRecordId: string | null = null;
    if (subdomain) dnsRecordId = await this.tryActivateSubdomain(subdomain);

    const rawWorkspace = await this.prismaService.workspaces.create({
      select: {
        workspace_index: true,
        workspace_name: true,
        workspace_subdomain: true,
        workspace_subdomain_active: true,
        workspace_created_at: true
      },
      data: {
        workspace_owner: owner,
        workspace_name: workspaceName,
        workspace_subdomain: subdomain,
        workspace_subdomain_active: dnsRecordId !== null,
        workspace_dns_record_id: dnsRecordId,
      }
    });

    return toCamelCase(rawWorkspace);
  }

  /**
   * 서브도메인을 활성화할 수 있으면 DNS 레코드를 생성하고 그 레코드 ID를 반환.
   * 활성 한도 초과/중복/ DNS 생성 실패 시 null 반환 (활성화 불가).
   */
  private async tryActivateSubdomain(subdomain: string, excludeWorkspaceIdx?: number): Promise<string | null> {
    const activeCount = await this.countActiveSubdomains();
    if (activeCount >= this.SUBDOMAIN_ACTIVE_LIMIT) return null;
    if (await this.isSubdomainTaken(subdomain, excludeWorkspaceIdx)) return null;

    try {
      return await this.cloudflareDnsUtility.createDnsRecord(subdomain);
    } catch (error) {
      log(error);
      return null;
    }
  }

  /**
   * 워크스페이스 서브도메인 활성화/비활성화 토글.
   * - 활성화: 한도 미초과 + 중복 없음일 때만 가능. DNS 레코드 생성.
   * - 비활성화: DNS 레코드 삭제 후 슬롯 반환.
   */
  async handleToggleWorkspaceSubdomain(owner: number, workspaceIdx: number, active: boolean) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: { workspace_index: workspaceIdx, workspace_owner: owner, workspace_deleted_at: null },
    });

    if (!workspace) throw new NotFoundException('Workspace Not Found.');
    if (!workspace.workspace_subdomain) throw new BadRequestException('This Workspace Has No Subdomain.');

    // 이미 원하는 상태면 그대로 반환
    if (workspace.workspace_subdomain_active === active) {
      return {
        workspaceIndex: workspace.workspace_index,
        workspaceSubdomain: workspace.workspace_subdomain,
        workspaceSubdomainActive: workspace.workspace_subdomain_active,
      };
    }

    if (active) {
      const activeCount = await this.countActiveSubdomains();
      if (activeCount >= this.SUBDOMAIN_ACTIVE_LIMIT) throw new ConflictException('Active Subdomain Limit Reached.');
      if (await this.isSubdomainTaken(workspace.workspace_subdomain, workspaceIdx)) throw new ConflictException('Subdomain Already In Use.');

      let dnsRecordId: string | null = null;
      try {
        dnsRecordId = await this.cloudflareDnsUtility.createDnsRecord(workspace.workspace_subdomain);
      } catch (error) {
        log(error);
      }
      if (!dnsRecordId) throw new ServiceUnavailableException('Failed to Create DNS Record.');

      const updated = await this.prismaService.workspaces.update({
        where: { workspace_index: workspaceIdx },
        data: { workspace_subdomain_active: true, workspace_dns_record_id: dnsRecordId },
        select: { workspace_index: true, workspace_subdomain: true, workspace_subdomain_active: true },
      });
      return toCamelCase(updated);
    }

    // 비활성화: DNS 레코드 삭제
    if (workspace.workspace_dns_record_id) {
      try {
        await this.cloudflareDnsUtility.deleteDnsRecord(workspace.workspace_dns_record_id);
      } catch (error) {
        log(error);
      }
    }

    const updated = await this.prismaService.workspaces.update({
      where: { workspace_index: workspaceIdx },
      data: { workspace_subdomain_active: false, workspace_dns_record_id: null },
      select: { workspace_index: true, workspace_subdomain: true, workspace_subdomain_active: true },
    });
    return toCamelCase(updated);
  }

  /**
   * 워크스페이스 서브도메인 값 변경.
   * - null/빈 값: 서브도메인 제거 (활성 상태였으면 DNS 삭제 후 비활성화).
   * - 활성 상태에서 값 변경: 새 값 중복 검사 후 기존 DNS 레코드 이름을 업데이트 (활성 유지).
   * - 비활성 상태: 값만 저장 (활성화는 별도 토글에서 한도 검증).
   */
  async handleUpdateWorkspaceSubdomain(owner: number, workspaceIdx: number, subdomain: string | null) {
    const workspace = await this.prismaService.workspaces.findFirst({
      where: { workspace_index: workspaceIdx, workspace_owner: owner, workspace_deleted_at: null },
    });

    if (!workspace) throw new NotFoundException('Workspace Not Found.');

    const newSubdomain = subdomain && subdomain.trim() ? subdomain.trim() : null;

    // 변경 사항 없음
    if (newSubdomain === workspace.workspace_subdomain) {
      return {
        workspaceIndex: workspace.workspace_index,
        workspaceSubdomain: workspace.workspace_subdomain,
        workspaceSubdomainActive: workspace.workspace_subdomain_active,
      };
    }

    // 서브도메인 제거: 활성 상태였으면 DNS 레코드 삭제 후 비활성화
    if (newSubdomain === null) {
      if (workspace.workspace_dns_record_id) {
        try {
          await this.cloudflareDnsUtility.deleteDnsRecord(workspace.workspace_dns_record_id);
        } catch (error) {
          log(error);
        }
      }
      const updated = await this.prismaService.workspaces.update({
        where: { workspace_index: workspaceIdx },
        data: { workspace_subdomain: null, workspace_subdomain_active: false, workspace_dns_record_id: null },
        select: { workspace_index: true, workspace_subdomain: true, workspace_subdomain_active: true },
      });
      return toCamelCase(updated);
    }

    // 활성 상태에서 값 변경: 중복 검사 후 기존 DNS 레코드 이름 업데이트
    if (workspace.workspace_subdomain_active && workspace.workspace_dns_record_id) {
      if (await this.isSubdomainTaken(newSubdomain, workspaceIdx)) throw new ConflictException('Subdomain Already In Use.');

      let ok = false;
      try {
        ok = await this.cloudflareDnsUtility.updateDnsRecord(newSubdomain, workspace.workspace_dns_record_id);
      } catch (error) {
        log(error);
      }
      if (!ok) throw new ServiceUnavailableException('Failed to Update DNS Record.');
    }

    // 비활성 상태거나 DNS 업데이트 완료 → 값 저장
    const updated = await this.prismaService.workspaces.update({
      where: { workspace_index: workspaceIdx },
      data: { workspace_subdomain: newSubdomain },
      select: { workspace_index: true, workspace_subdomain: true, workspace_subdomain_active: true },
    });
    return toCamelCase(updated);
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
        workspace_subdomain: true,
        workspace_subdomain_active: true,
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
      workspaceSubdomain: w.workspace_subdomain,
      workspaceSubdomainActive: w.workspace_subdomain_active,
      status: w.agents.length > 0 ? 'linked' : 'unlinked',
      lastOnline: w.agents[0]?.agent_last_online ?? null,
    }));

    return workspaceList;
  }

  async handleDeleteWorkspace(owner: number, workspaceIdx: number, ownerDisplay: string, confirmation: string) {
    const workspaceData = await this.prismaService.workspaces.findFirst({
      where: {
        workspace_index: workspaceIdx,
        workspace_owner: owner,
        workspace_deleted_at: null
      }
    });

    if (!workspaceData) throw new NotFoundException('Workspace Not Found');

    const expectedConfirmation = `${ownerDisplay}/${workspaceData.workspace_name}`;
    if (confirmation !== expectedConfirmation) throw new BadRequestException('Workspace delete confirmation does not match.');

    if (workspaceData.workspace_dns_record_id) {
      let deleted = false;
      try {
        deleted = await this.cloudflareDnsUtility.deleteDnsRecord(workspaceData.workspace_dns_record_id);
      } catch (error) {
        log(error);
      }
      if (!deleted) throw new ServiceUnavailableException('Failed to Delete DNS Record.');
    }

    const workspaceDeleteTimestamp = new Date();

    await this.prismaService.workspaces.update({
      where: {
        workspace_index: workspaceIdx,
        workspace_owner: owner,
        workspace_deleted_at: null
      },
      data: {
        workspace_deleted_at: workspaceDeleteTimestamp,
        workspace_subdomain_active: false,
        workspace_dns_record_id: null,
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

  /**
   * 에이전트와 연결되어 있고 그 워크스페이스가 삭제되지 않았는지 확인 후 삭제를 진행하는 서비스
   */
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

    if (!rawAgent) throw new NotFoundException('에이전트를 찾을 수 없습니다.');
    if (rawAgent.agent_connection !== 'linked') throw new BadRequestException('에이전트와 연결되지 않았습니다.');

    const rawUpdatedAgent = await this.prismaService.agents.update({
      where: {
        agent_code: rawAgent.agent_code,
      },
      data: {
        agent_connection: 'unlinked',
        agent_parent_workspace: null,
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
