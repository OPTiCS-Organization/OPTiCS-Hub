import { Module } from '@nestjs/common';
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
import { ReleasesModule } from './releases/releases.module';
import { AgentModule } from './agent/agent.module';
import { TunnelModule } from './tunnel/tunnel.module';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { UtilityModule } from './utility/utility.module';
import { MailerModule } from './mailer/mailer.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AgentModule,
    AuthModule,
    ReleasesModule,
    ServiceModule,
    StatsModule,
    TunnelModule,
    UtilityModule,
    WorkspaceModule,
    MailerModule.forRootAsync(),
  ],
  providers: [
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: TokenRefreshFilter },
  ],
})
export class AppModule {}
