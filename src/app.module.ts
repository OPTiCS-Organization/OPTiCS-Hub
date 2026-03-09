import { Module } from '@nestjs/common';
import { ServerController } from './server/server.controller';
import { ServerService } from './server/server.service';
import { ServerModule } from './server/server.module';
import { AuthModule } from './auth/auth.module';
import { APP_FILTER } from '@nestjs/core';
import {
  HttpExceptionFilter,
  TokenRefreshFilter,
} from './global/Global.filter';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [
    ServerModule,
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
  controllers: [ServerController],
  providers: [
    ServerService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: TokenRefreshFilter },
  ],
})
export class AppModule {}
