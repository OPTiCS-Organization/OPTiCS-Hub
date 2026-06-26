import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AgentGateway } from 'src/agent/agent.gateway';
import { PrismaService } from 'src/prisma.service';

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
  async sendProxyInfo(serviceSubdomain: string, workspaceSubdomain: string, token: string) {
    const normalizedServiceSubdomain = serviceSubdomain.trim().toLowerCase() === '@'
      ? ''
      : serviceSubdomain.trim().toLowerCase();
    const workspace = await this.prismaService.workspaces.findFirst({
      select: {
        workspace_index: true
      },
      where: {
        workspace_subdomain: workspaceSubdomain,
        workspace_subdomain_active: true,
      }
    });

    if (!workspace) throw new NotFoundException('Workspace not found');

    const endpoint = await this.prismaService.service_endpoints.findFirst({
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
    });

    if (!endpoint) throw new NotFoundException('Service not found');

    if (!endpoint.service.agent || endpoint.service.agent.agent_connection !== 'linked' || endpoint.service.agent.agent_deleted_at) {
      throw new NotFoundException('Agent not found');
    }

    const response = this.agentGateway.sendToAgent(endpoint.service.agent.agent_uuid, 'tunnel-connect', {
      'token': token,
      'service_port': endpoint.endpoint_host_port,
      'tunnel_port': 5220,
    });

    if (!response) throw new ServiceUnavailableException('Agent is probably offline');
  }
}
