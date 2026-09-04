import { Module } from '@nestjs/common';
import { ServiceService } from './service.service';
import { ServiceController } from './v1/service.controller';
import { AgentModule } from 'src/agent/agent.module';
import { TunnelModule } from 'src/tunnel/tunnel.module';

@Module({
  imports: [AgentModule, TunnelModule],
  providers: [ServiceService],
  controllers: [ServiceController],
})
export class ServiceModule {}
