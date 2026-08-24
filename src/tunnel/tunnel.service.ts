import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AgentGateway } from 'src/agent/agent.gateway';
import { PrismaService } from 'src/prisma.service';
import { TUNNEL_OUTCOME, type TunnelOutcome } from './tunnel-outcome';

@Injectable()
export class TunnelService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
  ) { };

  /**
   * 워크스페이스 서브도메인과 서비스 서브도메인으로 대상 서비스를 찾고,
   * 해당 서비스에 연결된 배포 에이전트로 터널 연결 정보를 전달한다.
   */
  async sendProxyInfo(serviceSubdomain: string, workspaceSubdomain: string, token: string, requestId: string) {
    const normalizedServiceSubdomain = serviceSubdomain.trim().toLowerCase() === '@' ? '' : serviceSubdomain.trim().toLowerCase();
    let workspaceQueryMs = 0;
    let endpointQueryMs = 0;
    let queryCount = 0;
    let outcome: TunnelOutcome = TUNNEL_OUTCOME.DB_ERROR;

    try {
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

      if (!endpoint.service.agent || endpoint.service.agent.agent_connection !== 'linked' || endpoint.service.agent.agent_deleted_at) {
        outcome = TUNNEL_OUTCOME.AGENT_NOT_FOUND;
        throw new NotFoundException({ outcome, message: 'Agent not found' });
      }

      const response = this.agentGateway.sendToAgent(endpoint.service.agent.agent_uuid, 'tunnel-connect', {
        'token': token,
        'service_port': endpoint.endpoint_host_port,
        'tunnel_port': 5220,
      });

      if (!response) {
        outcome = TUNNEL_OUTCOME.AGENT_OFFLINE;
        throw new ServiceUnavailableException({ outcome, message: 'Agent is probably offline' });
      }

      outcome = TUNNEL_OUTCOME.SUCCESS;
      return {
        outcome,
        request_id: requestId,
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
