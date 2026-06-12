import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AgentGateway } from 'src/agent/agent.gateway';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class TunnelService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly agentGateway: AgentGateway,
  ) { };

  async sendProxyInfo(subdomain: string, token: string) {
    const service = await this.prismaService.services.findFirst({
      select: {
        service_parent_agent: true,
        service_status: true,
        service_host_port: true,
      },
      where: {
        service_subdomain: subdomain,
        service_deleted_at: null,
      }
    });

    if (!service) throw new NotFoundException('Service not found');

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_index: service.service_parent_agent
      }
    });

    if (!agent) throw new NotFoundException('Agent not found');

    const response = this.agentGateway.sendToAgent(agent?.agent_uuid, 'tunnel-connect', { 'token': token, 'service_port': service.service_host_port, 'tunnel_port': 5220 });

    if (!response) throw new ServiceUnavailableException('Agent is probably offline');
  }
}
