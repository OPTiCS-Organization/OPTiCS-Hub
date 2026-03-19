import { Module } from '@nestjs/common';
import { AgentController } from './v1/agent.controller';
import { AgentService } from './agent.service';

@Module({
  controllers: [AgentController],
  providers: [AgentService]
})
export class AgentModule {}
