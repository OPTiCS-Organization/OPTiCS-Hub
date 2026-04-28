import { Module } from '@nestjs/common';
import { AgentController } from './v1/agent.controller';
import { AgentService } from './agent.service';
import { AgentGateway } from './agent.gateway';
import { ConsoleGateway } from './console.gateway';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AgentController],
  providers: [AgentService, AgentGateway, ConsoleGateway],
  exports: [AgentGateway, ConsoleGateway],
})
export class AgentModule {}
