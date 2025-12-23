import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { generate } from 'random-words';
import log from 'spectra-log';
import { prisma } from 'src/util/prisma.util';

@Injectable()
export class ServerService {

  handleHeartbeat(data) {
    log(data);
  }

  async handleInitializeServer(data, ip) {
    const connection = await prisma.connections.findFirst({ where: { connection_ip: ip, connection_expired: false } });

    if (connection) {
      const connectionTimestamp = new Date(connection.connection_timestamp).getTime();

      if (Date.now() - connectionTimestamp < ms('1d')) {
        return connection.connection_code;
      }
    }

    const newConnection = await prisma.connections.create({
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
