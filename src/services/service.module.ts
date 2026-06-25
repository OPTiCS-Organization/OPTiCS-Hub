import { Module } from '@nestjs/common';
import { ServiceService } from './service.service';
import { ServiceController } from './v1/service.controller';
import { AgentModule } from 'src/agent/agent.module';

@Module({
  imports: [AgentModule],
  providers: [ServiceService],
  controllers: [ServiceController],
})
export class ServiceModule {}
