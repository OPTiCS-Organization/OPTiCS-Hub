import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspaces/v1/workspace.controller';
import { WorkspaceService } from './workspaces/workspace.service';
import { WorkspaceModule } from './workspaces/workspace.module';
import { ServiceModule } from './services/service.module';
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
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { UtilityModule } from './utility/utility.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    WorkspaceModule,
    ServiceModule,
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentModule,
    TunnelModule,
    UtilityModule,
  ],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: TokenRefreshFilter },
  ],
})
export class AppModule {}
