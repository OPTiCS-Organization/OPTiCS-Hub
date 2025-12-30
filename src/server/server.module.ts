import { Module } from '@nestjs/common';
import { ServerService } from './server.service';
import { ServerController } from './server.controller';
import { PrismaService } from 'src/prisma.service';

@Module({
  providers: [
    ServerService,
    PrismaService,
  ],
  controllers: [ServerController]
})
export class ServerModule {}
