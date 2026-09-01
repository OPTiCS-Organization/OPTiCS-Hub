import { Module } from '@nestjs/common';
import { AgentController } from './v1/agent.controller';
import { AgentService } from './agent.service';
import { AgentGateway } from './agent.gateway';
import { ConsoleGateway } from './console.gateway';
import { AgentUpdateService } from './agent-update.service';
import { AuthModule } from 'src/auth/auth.module';
import { ReleasesModule } from 'src/releases/releases.module';

@Module({
  imports: [AuthModule, ReleasesModule],
  controllers: [AgentController],
  providers: [AgentService, AgentGateway, ConsoleGateway, AgentUpdateService],
  exports: [AgentService, AgentGateway, ConsoleGateway, AgentUpdateService],
})
export class AgentModule {}
