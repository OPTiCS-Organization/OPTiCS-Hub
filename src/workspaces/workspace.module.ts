import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { WorkspaceController } from './v1/workspace.controller';
import { AgentModule } from 'src/agent/agent.module';
import { UtilityModule } from 'src/utility/utility.module';

@Module({
  imports: [AgentModule, UtilityModule],
  providers: [WorkspaceService],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
