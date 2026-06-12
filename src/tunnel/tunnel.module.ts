import { Module } from '@nestjs/common';
import { TunnelController } from './v1/tunnel.controller';
import { TunnelService } from './tunnel.service';
import { PrismaModule } from 'src/prisma.module';
import { AgentModule } from 'src/agent/agent.module';

@Module({
  imports: [AgentModule, PrismaModule],
  controllers: [TunnelController],
  providers: [TunnelService]
})
export class TunnelModule {}
