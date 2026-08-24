import { Injectable, forwardRef, Inject, OnModuleInit, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { AgentUpdatePhase } from '@prisma/client';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { AgentGateway } from './agent.gateway';
import { ConsoleGateway } from './console.gateway';
import { ReleaseCatalogService } from 'src/releases/release-catalog.service';

/** Hub가 보내는 값이 Agent에서 그대로 이미지 태그가 되므로 여기서도 좁게 막는다. */
const TAG_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;

/**
 * 업데이트가 이 시간 안에 끝나지 않으면 실패로 본다.
 * 이미지 pull(수 분) + 기동(~10초) + 롤백 사이클(~60초)을 모두 덮을 만큼 넉넉해야 하고,
 * 그보다 길면 사용자가 영원히 '업데이트 중'을 보게 된다.
 */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/** 아직 결과가 나오지 않은, 즉 소켓이 끊겨도 오프라인으로 보면 안 되는 단계. */
const IN_FLIGHT: AgentUpdatePhase[] = ['requested', 'pulling', 'restarting'];

/**
 * Agent 자기 교체의 상태 머신.
 *
 * 교체 도중 Agent 프로세스는 죽고, 실제 작업을 하는 업데이터 컨테이너는 Hub와 통신할
 * 자격증명이 없다. 전 구간 살아 있는 주체가 Hub뿐이라 상태를 여기서 소유한다.
 */
@Injectable()
export class AgentUpdateService implements OnModuleInit {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => AgentGateway))
    private readonly agentGateway: AgentGateway,
    @Inject(forwardRef(() => ConsoleGateway))
    private readonly consoleGateway: ConsoleGateway,
    private readonly releaseCatalogService: ReleaseCatalogService,
  ) { }

  async onModuleInit() {
    await this.resetStalePhases();
  }

  /** Hub가 재시작되면 진행 중이던 업데이트의 결말을 알 수 없다. 미결 상태로 남기지 않는다. */
  private async resetStalePhases() {
    await this.prismaService.agents.updateMany({
      where: { agent_update_phase: { in: IN_FLIGHT } },
      data: {
        agent_update_phase: 'failed',
        agent_update_message: 'Hub가 재시작되어 업데이트 결과를 확인하지 못했다.',
      },
    });
  }

  async requestUpdate(agentUuid: string, targetVersion: string) {
    if (!TAG_PATTERN.test(targetVersion)) {
      throw new BadRequestException('Malformed target version.');
    }

    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid, agent_deleted_at: null },
      select: { agent_status: true, agent_update_phase: true, agent_version: true },
    });
    if (!agent) throw new NotFoundException('Agent not found.');
    if (agent.agent_status !== 'online') {
      throw new ConflictException('Agent is offline.');
    }
    if (IN_FLIGHT.includes(agent.agent_update_phase)) {
      throw new ConflictException('Another update is already in progress.');
    }

    // 카탈로그에 있고, 회수되지 않았고, 프로토콜이 Hub 지원 범위 안인지 확인한다.
    // 여기를 통과했다는 것은 GHCR에 이미지가 실제로 존재한다는 뜻이기도 하다.
    await this.releaseCatalogService.assertInstallable(targetVersion);

    const sent = this.agentGateway.sendToAgent(agentUuid, 'update-agent', { version: targetVersion });
    if (!sent) throw new ConflictException('Agent is not connected.');

    await this.transition(agentUuid, 'requested', {
      target: targetVersion,
      message: `${agent.agent_version ?? '알 수 없는 버전'} → ${targetVersion} 업데이트를 요청했다.`,
      startedAt: new Date(),
    });
    this.armTimeout(agentUuid);
  }

  /**
   * 업데이터 컨테이너의 로그 한 줄.
   * Agent는 자기가 죽기 전까지만 이걸 중계할 수 있으므로, 대개 pull 구간까지만 도착한다.
   */
  async recordProgress(agentUuid: string, line: string) {
    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: { agent_update_phase: true },
    });
    if (!agent || !IN_FLIGHT.includes(agent.agent_update_phase)) return;

    await this.transition(agentUuid, agent.agent_update_phase === 'requested' ? 'pulling' : agent.agent_update_phase, {
      message: line.slice(0, 2000),
    });
  }

  /**
   * 소켓이 끊겼을 때, 그것이 예정된 재시작인지 알려준다.
   * true면 호출부는 오프라인 처리를 건너뛰어야 한다. 업데이트마다 Agent가 오프라인으로
   * 깜빡이면 사용자에게는 정상 동작이 아니라 사고로 보인다.
   */
  async isExpectedRestart(agentUuid: string): Promise<boolean> {
    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: { agent_update_phase: true, agent_update_target: true },
    });
    if (!agent || !IN_FLIGHT.includes(agent.agent_update_phase)) return false;

    // 오프라인이 아니라 '재시작 중'으로 둔다. AgentStatus에 이미 있는 값이고 Console도 렌더링한다.
    // 재접속 시 registerAgent가 online으로 되돌리고, 끝내 안 오면 expire()가 offline으로 내린다.
    await this.prismaService.agents.updateMany({
      where: { agent_uuid: agentUuid },
      data: { agent_status: 'restarting' },
    });
    await this.transition(agentUuid, 'restarting', {
      message: `v${agent.agent_update_target ?? '?'}(으)로 교체 중이다. 곧 다시 연결된다.`,
    });
    return true;
  }

  /**
   * Agent가 돌아왔다. 보고한 버전이 목표와 다르면 업데이터가 롤백한 것이다.
   * 업데이터는 Hub와 통신할 수 없으므로, 롤백 여부를 알 수 있는 유일한 신호가 이 버전 비교다.
   */
  async handleReconnect(agentUuid: string, reportedVersion: string | null) {
    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: { agent_update_phase: true, agent_update_target: true },
    });
    if (!agent || agent.agent_update_phase === 'idle') return;
    if (!IN_FLIGHT.includes(agent.agent_update_phase)) return;

    this.clearTimeout(agentUuid);
    const target = agent.agent_update_target;

    if (reportedVersion && target && reportedVersion === target) {
      await this.transition(agentUuid, 'succeeded', { message: `v${target} 업데이트를 완료했다.` });
      return;
    }
    await this.transition(agentUuid, 'rolled_back', {
      message: `v${target ?? '?'} 기동에 실패해 v${reportedVersion ?? '?'}(으)로 되돌아왔다.`,
    });
  }

  /** 사용자가 결과 표시를 닫는다. 성공/실패 배지를 언제까지 띄울지는 사용자가 정한다. */
  async acknowledge(agentUuid: string) {
    await this.transition(agentUuid, 'idle', { target: null, message: null, startedAt: null });
  }

  private armTimeout(agentUuid: string) {
    this.clearTimeout(agentUuid);
    const timer = setTimeout(() => {
      this.timers.delete(agentUuid);
      void this.expire(agentUuid);
    }, UPDATE_TIMEOUT_MS);
    this.timers.set(agentUuid, timer);
  }

  private clearTimeout(agentUuid: string) {
    const timer = this.timers.get(agentUuid);
    if (timer) {
      global.clearTimeout(timer);
      this.timers.delete(agentUuid);
    }
  }

  private async expire(agentUuid: string) {
    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: { agent_update_phase: true, agent_update_target: true },
    });
    if (!agent || !IN_FLIGHT.includes(agent.agent_update_phase)) return;

    await this.transition(agentUuid, 'failed', {
      message: `v${agent.agent_update_target ?? '?'} 업데이트가 시간 안에 끝나지 않았다. Agent 호스트에서 'docker logs optics-agent-updater'로 원인을 확인해야 한다.`,
    });
    // 예정된 재시작으로 보고 오프라인 처리를 미뤄뒀으므로, 여기서 실제 상태를 되돌려준다.
    await this.prismaService.agents.updateMany({
      where: { agent_uuid: agentUuid },
      data: { agent_status: 'offline' },
    });
    log(`[Agent Update] Update timed out: ${agentUuid}`, 500, 'ERROR');
  }

  private async transition(
    agentUuid: string,
    phase: AgentUpdatePhase,
    fields: { target?: string | null; message?: string | null; startedAt?: Date | null } = {},
  ) {
    const data: Record<string, unknown> = { agent_update_phase: phase };
    if ('target' in fields) data.agent_update_target = fields.target;
    if ('message' in fields) data.agent_update_message = fields.message;
    if ('startedAt' in fields) data.agent_update_started_at = fields.startedAt;

    await this.prismaService.agents.updateMany({ where: { agent_uuid: agentUuid }, data });

    const agent = await this.prismaService.agents.findFirst({
      where: { agent_uuid: agentUuid },
      select: {
        agent_parent_workspace: true,
        agent_code: true,
        agent_version: true,
        agent_update_target: true,
        agent_update_message: true,
        agent_update_started_at: true,
      },
    });
    if (!agent?.agent_parent_workspace) return;

    this.consoleGateway.emitToWorkspace(agent.agent_parent_workspace, 'agent-update', {
      agentUuid,
      agentCode: agent.agent_code,
      agentVersion: agent.agent_version,
      updatePhase: phase,
      updateTarget: agent.agent_update_target,
      updateMessage: agent.agent_update_message,
      updateStartedAt: agent.agent_update_started_at,
    });
  }
}
