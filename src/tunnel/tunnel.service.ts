import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AgentGateway } from 'src/agent/agent.gateway';
import { AgentService } from 'src/agent/agent.service';
import {
  NONCE_FIELD,
  ReplayGuard,
  SIGNATURE_FIELD,
  TIMESTAMP_FIELD,
  verify,
} from 'src/global/hash.util';
import { PrismaService } from 'src/prisma.service';
import type { RequestPreconnect } from './dto/RequestPreconnect.dto';
import { TUNNEL_OUTCOME, type TunnelOutcome } from './tunnel-outcome';

/** 서명 비밀 캐시 수명. PRE마다 DB를 때리지 않기 위한 것이다. */
const SIGNING_SECRET_TTL_MS = 60_000;

/**
 * 라우팅 조회 캐시 수명.
 *
 * 게이트웨이는 풀이 비면 같은 주소를 밀리초 간격으로 두 번 요청한다.(풀 조회 → 폴백).
 * 캐시가 없으면 단일 요청에에 워크스페이스와 라우팅 테이블에 쿼리가 4번 입력된다.
 */
const ROUTE_CACHE_TTL_MS = 5_000;

type CachedRoute = { agentUuid: string; servicePort: number; expiresAt: number };

@Injectable()
export class TunnelService {
  private readonly replayGuard = new ReplayGuard();
  private readonly signingSecretCache = new Map<string, { secret: string | null; expiresAt: number }>();
  /** 성공한 라우팅만 담는다. 실패는 담지 않아야 서비스가 살아난 즉시 반영된다. */
  private readonly routeCache = new Map<string, CachedRoute>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
    private readonly agentService: AgentService,
  ) { };

  /**
   * 게이트웨이가 넘긴 PRE 줄의 서명을 검증한다.
   *
   * 비밀을 게이트웨이로 내보내지 않고 검증만 대신해 주는 형태다. 비밀이 Hub 밖으로
   * 나가지 않고, 재전송 가드도 한 곳에만 있으면 된다.
   */
  async verifyPreconnect(request: RequestPreconnect): Promise<{ ok: true } | { ok: false; reason: string }> {
    const envelope = {
      agentUuid: request.agentUuid,
      [TIMESTAMP_FIELD]: request.timestamp,
      [NONCE_FIELD]: request.nonce,
      [SIGNATURE_FIELD]: request.signature,
    };

    const cached = this.signingSecretCache.get(request.agentUuid);
    const servedFromCache = cached !== undefined && cached.expiresAt > Date.now();
    const secret = servedFromCache
      ? cached.secret
      : await this.cacheSigningSecret(request.agentUuid);

    let result = verify('tunnel:pre', envelope, secret, { replayGuard: this.replayGuard });

    /*
     * 서명이 안 맞고 그 비밀이 캐시에서 나온 것이라면 재발급으로 만료되었을 수 있다.
     * DB에서 다시 조회하여 검사한다. 실패한 verify는 서명 대조에서 면저 거부되기 때문에
     * nonce를 가드에 등록하지 않으므로 다시 시도해도 안전하다.
     */
    if (!result.ok && result.reason === 'invalid_signature' && servedFromCache) {
      const fresh = await this.cacheSigningSecret(request.agentUuid);
      result = verify('tunnel:pre', envelope, fresh, { replayGuard: this.replayGuard });
    }

    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  /**
   * 찾은 Agent에게 터널을 생성하라 명령한다.
   *
   * 게이트웨이가 풀에서 꺼내 쓰겠다고 했으면 명령을 보내지 않는다. Agent는 이미
   * 소켓을 열어 두었으므로 tunnel-connect가 필요 없다.
   */
  private dispatchToAgent(agentUuid: string, servicePort: number, token: string, preferPooled: boolean): TunnelOutcome {
    if (preferPooled) return TUNNEL_OUTCOME.SUCCESS;

    const delivered = this.agentGateway.sendToAgent(agentUuid, 'tunnel-connect', {
      'token': token,
      'service_port': servicePort,
      'tunnel_port': 5220,
    });
    return delivered ? TUNNEL_OUTCOME.SUCCESS : TUNNEL_OUTCOME.AGENT_OFFLINE;
  }

  /**
   * 라우팅 캐시를 통째로 비운다.
   *
   * 차단은 즉시 걸려야 하는데, 캐시된 경로는 DB를 보지 않고 그대로 통과한다.
   * 항목을 골라 지우려면 서비스에 달린 엔드포인트 서브도메인을 전부 되짚어야 하고,
   * 그 조회가 틀리면 차단이 조용히 새어 나간다. 캐시는 수명이 5초이고 크기도 작아
   * 전부 버리는 편이 싸고 확실하다.
   */
  invalidateRouteCache() {
    this.routeCache.clear();
  }

  private async cacheSigningSecret(agentUuid: string) {
    const secret = await this.agentService.getSigningSecret(agentUuid);
    this.signingSecretCache.set(agentUuid, { secret, expiresAt: Date.now() + SIGNING_SECRET_TTL_MS });
    return secret;
  }

  /**
   * 워크스페이스 서브도메인과 서비스 서브도메인으로 대상 서비스를 찾고,
   * 해당 서비스에 연결된 배포 에이전트로 터널 연결 정보를 전달한다.
   */
  async sendProxyInfo(serviceSubdomain: string, workspaceSubdomain: string, token: string, requestId: string, preferPooled = false) {
    const normalizedServiceSubdomain = serviceSubdomain.trim().toLowerCase() === '@' ? '' : serviceSubdomain.trim().toLowerCase();
    let workspaceQueryMs = 0;
    let endpointQueryMs = 0;
    let queryCount = 0;
    let outcome: TunnelOutcome = TUNNEL_OUTCOME.DB_ERROR;
    /** hidden 모드는 밖으로 나가는 outcome을 가리므로, 로그에는 따로 남겨야 추적이 된다. */
    let blocked = false;
    const routeKey = `${workspaceSubdomain}/${normalizedServiceSubdomain}`;
    let servedFromCache = false;

    try {
      const cached = this.routeCache.get(routeKey);
      if (cached && cached.expiresAt > Date.now()) {
        servedFromCache = true;
        outcome = this.dispatchToAgent(cached.agentUuid, cached.servicePort, token, preferPooled);
        if (outcome !== TUNNEL_OUTCOME.SUCCESS) {
          throw new ServiceUnavailableException({ outcome, message: 'Agent is probably offline' });
        }
        return {
          outcome,
          request_id: requestId,
          agent_uuid: cached.agentUuid,
          service_port: cached.servicePort,
          hub_db_query_ms: 0,
          workspace_query_ms: 0,
          endpoint_query_ms: 0,
        };
      }

      queryCount += 1;
      const workspace = await measureQuery(
        () => this.prismaService.workspaces.findFirst({
          select: {
            workspace_index: true
          },
          where: {
            workspace_subdomain: workspaceSubdomain,
            workspace_subdomain_active: true,
          }
        }),
        (durationMs) => { workspaceQueryMs = durationMs; },
      );

      if (!workspace) {
        outcome = TUNNEL_OUTCOME.WORKSPACE_NOT_FOUND;
        throw new NotFoundException({ outcome, message: 'Workspace not found' });
      }

      queryCount += 1;
      const endpoint = await measureQuery(
        () => this.prismaService.service_endpoints.findFirst({
          select: {
            endpoint_host_port: true,
            service: {
              select: {
                service_status: true,
                service_traffic_blocked_at: true,
                service_traffic_block_mode: true,
                agent: {
                  select: {
                    agent_uuid: true,
                    agent_connection: true,
                    agent_deleted_at: true,
                  },
                },
              },
            },
          },
          where: {
            endpoint_parent_workspace: workspace.workspace_index,
            endpoint_subdomain: normalizedServiceSubdomain,
            endpoint_deleted_at: null,
            service: {
              service_deleted_at: null,
            },
          }
        }),
        (durationMs) => { endpointQueryMs = durationMs; },
      );

      if (!endpoint) {
        outcome = TUNNEL_OUTCOME.SERVICE_NOT_FOUND;
        throw new NotFoundException({ outcome, message: 'Service not found' });
      }

      /*
       * 차단은 에이전트를 보기 전에 끊는다. 운영자가 트래픽을 막았다면 에이전트가
       * 살아 있는지는 답을 바꾸지 않고, 살아 있을 때 tunnel-connect를 보내면
       * 차단한 서비스로 소켓이 한 번 열린다.
       */
      if (endpoint.service.service_traffic_blocked_at) {
        blocked = true;
        /*
         * hidden은 존재 자체를 숨긴다. 게이트웨이는 outcome 하나로만 페이지를 고르므로
         * 여기서 service_not_found로 바꿔 보내면 없는 서비스와 응답이 완전히 같아진다.
         * 게이트웨이에 모드를 알려 주고 거기서 다시 분기하게 만들면 분기 축이 둘로 늘어난다.
         */
        const hidden = endpoint.service.service_traffic_block_mode === 'hidden';
        outcome = hidden ? TUNNEL_OUTCOME.SERVICE_NOT_FOUND : TUNNEL_OUTCOME.SERVICE_BLOCKED;
        throw hidden
          ? new NotFoundException({ outcome, message: 'Service not found' })
          : new ServiceUnavailableException({ outcome, message: 'Service traffic is blocked' });
      }

      if (!endpoint.service.agent || endpoint.service.agent.agent_connection !== 'linked' || endpoint.service.agent.agent_deleted_at) {
        outcome = TUNNEL_OUTCOME.AGENT_NOT_FOUND;
        throw new NotFoundException({ outcome, message: 'Agent not found' });
      }

      const agentUuid = endpoint.service.agent.agent_uuid;

      // 성공한 조회만 담는다. 실패를 담으면 서비스가 살아나도 TTL 동안 계속 실패한다.
      this.routeCache.set(routeKey, {
        agentUuid,
        servicePort: endpoint.endpoint_host_port,
        expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
      });

      outcome = this.dispatchToAgent(agentUuid, endpoint.endpoint_host_port, token, preferPooled);
      if (outcome !== TUNNEL_OUTCOME.SUCCESS) {
        throw new ServiceUnavailableException({ outcome, message: 'Agent is probably offline' });
      }

      return {
        outcome,
        request_id: requestId,
        agent_uuid: agentUuid,
        service_port: endpoint.endpoint_host_port,
        hub_db_query_ms: roundMilliseconds(workspaceQueryMs + endpointQueryMs),
        workspace_query_ms: roundMilliseconds(workspaceQueryMs),
        endpoint_query_ms: roundMilliseconds(endpointQueryMs),
      };
    } finally {
      console.info(JSON.stringify({
        timestamp: new Date().toISOString(),
        component: 'hub',
        event: 'hub_tunnel_db_queries_completed',
        request_id: requestId,
        outcome,
        blocked,
        route_cached: servedFromCache,
        query_count: queryCount,
        hub_db_query_ms: roundMilliseconds(workspaceQueryMs + endpointQueryMs),
        workspace_query_ms: roundMilliseconds(workspaceQueryMs),
        endpoint_query_ms: roundMilliseconds(endpointQueryMs),
      }));
    }
  }
}

function roundMilliseconds(value: number) {
  return Math.round(value * 100) / 100;
}

async function measureQuery<T>(
  query: () => Promise<T>,
  recordDuration: (durationMs: number) => void,
) {
  const startedAt = performance.now();
  try {
    return await query();
  } finally {
    recordDuration(performance.now() - startedAt);
  }
}
