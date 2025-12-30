import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtUtil } from './util/jwt.util';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './interceptor/strategy/jwt.strategy';
import { JwtGuard } from './interceptor/guard/jwt.guard';
import { PrismaService } from 'src/prisma.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('SECURITY_JWT_SECRET')
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    AuthController,
  ],
  providers: [
    AuthService,
    JwtUtil,
    JwtStrategy,
    JwtGuard,
    PrismaService,
  ],
  exports: [
    AuthModule,
    JwtModule,
    JwtStrategy,
    JwtGuard,
    JwtUtil,
  ],
})
export class AuthModule { }