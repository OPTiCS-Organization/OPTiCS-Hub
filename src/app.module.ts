import { Module } from '@nestjs/common';
import { ServerController } from './server/server.controller';
import { ServerService } from './server/server.service';
import { ServerModule } from './server/server.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [ServerModule, AuthModule],
  controllers: [ServerController],
  providers: [ServerService],
})
export class AppModule { }
