import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
    const connection = await this.prismaService.agents.findFirst({
      where: {
        agent_ip: ip,
        agent_deleted_at: null,
        agent_created_at: {
          gte: new Date(Date.now() - ms('1d')),
        }
      }
    });

    if (connection) return connection.agent_token;

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
    const container = await this.prismaService.containers.findFirst({
      where: {
        container_owner: owner,
        container_index: targetContainerIdx,
      },
    });

    if (!container) throw new NotFoundException('Container Not Found.');
    if (container.agent_token) throw new ConflictException('This Agent has Already Linked With Another Container.');

    container.agent_token = targetAgentCode;
    container.container_status = 'linked';

    return await this.prismaService.$transaction([
      this.prismaService.containers.update({
        where: {
          container_owner: owner,
          container_index: targetContainerIdx,
        },
        data: {
          agent_token: targetAgentCode,
          container_status: 'linked',
        }
      }),
      this.prismaService.agents.update({
        where: {
          agent_token: targetAgentCode,
        },
        data: {
          agent_established: true,
        }
      }),
    ])[0];

  }
}
