import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { WorkspaceController } from './v1/workspace.controller';
import { AgentModule } from 'src/agent/agent.module';

@Module({
  imports: [AgentModule],
  providers: [WorkspaceService],
  controllers: [WorkspaceController],
})
export class WorkspaceModule {}
