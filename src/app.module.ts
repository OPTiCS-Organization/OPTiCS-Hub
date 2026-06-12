import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspaces/v1/workspace.controller';
import { WorkspaceService } from './workspaces/workspace.service';
import { WorkspaceModule } from './workspaces/workspace.module';
import { AuthModule } from './auth/auth.module';
import { APP_FILTER } from '@nestjs/core';
import {
  HttpExceptionFilter,
  TokenRefreshFilter,
} from './global/Global.filter';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma.module';
import { AgentModule } from './agent/agent.module';
import { TunnelModule } from './tunnel/tunnel.module';

@Module({
  imports: [
    WorkspaceModule,
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentModule,
    TunnelModule,
  ],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: TokenRefreshFilter },
  ],
})
export class AppModule {}
