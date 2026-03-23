import { Module } from '@nestjs/common';
import { AgentController } from './v1/agent.controller';
import { AgentService } from './agent.service';
import { AgentGateway } from './agent.gateway';

@Module({
  controllers: [AgentController],
  providers: [AgentService, AgentGateway],
})
export class AgentModule {}
