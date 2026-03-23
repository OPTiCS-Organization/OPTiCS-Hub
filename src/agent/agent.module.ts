import { Module } from '@nestjs/common';
import { AgentController } from './v1/agent.controller';
import { AgentService } from './agent.service';
import { AgentGateway } from './agent.gateway';
import { ConsoleGateway } from './console.gateway';

@Module({
  controllers: [AgentController],
  providers: [AgentService, AgentGateway, ConsoleGateway],
  exports: [AgentGateway, ConsoleGateway],
})
export class AgentModule {}
