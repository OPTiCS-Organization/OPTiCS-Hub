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
    const connection = await this.prismaService.connections.findFirst({ where: { connection_ip: ip, connection_expired: false } });

    if (connection) {
      const connectionTimestamp = new Date(connection.connection_timestamp).getTime();

      if (Date.now() - connectionTimestamp < ms('1d')) {
        return connection.connection_code;
      }
    }

    const newConnection = await this.prismaService.connections.create({
      data: {
        connection_ip: ip,
        connection_code: generate() + '-' + generate(),
      }
    });

    return newConnection.connection_code;
  }

  async handleCreateHost() {

  }
}
