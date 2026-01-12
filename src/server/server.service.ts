import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { generate } from 'random-words';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class ServerService {
  constructor(
    private readonly prismaService: PrismaService,
  ) { };

  handleHeartbeat(data) {
    log(data);
  }

  async handleInitializeServer(data, ip) {
    const connection = await this.prismaService.agents.findFirst({ where: { agent_ip: ip, agent_deleted_at: null } });

    if (connection) {
      const connectionTimestamp = new Date(connection.agent_created_at).getTime();

      if (Date.now() - connectionTimestamp < ms('1d')) {
        return connection.agent_token;
      }
    }

    const newConnection = await this.prismaService.agents.create({
      data: {
        agent_ip: ip,
        agent_token: generate() + '-' + generate(),
      }
    });

    return newConnection.agent_token;
  }

  async handleCreateContainer(owner: number, containerName: string | undefined) {
    const newContainer = await this.prismaService.containers.create({
      data: {
        container_owner: owner,
        container_name: containerName ?? 'Unnamed Container',
      }
    });

    return newContainer;
  }

  async handleConnectContainer(owner: number, targetContainerIdx: number, targetAgentCode: string) {
    const containerInfo = await this.prismaService.containers.update({
      where: {
        container_owner: owner,
        container_index: targetContainerIdx,
      },
      data: {
        agent_token: targetAgentCode,
        container_status: 'linked',
      }
    });
    return containerInfo;
  }
}
