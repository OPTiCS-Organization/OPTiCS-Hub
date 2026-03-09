import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import log from 'spectra-log';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly configService: ConfigService) {
    const adapter = new PrismaMariaDb({
      host: configService.getOrThrow<string>('DATABASE_HOST'),
      user: configService.getOrThrow<string>('DATABASE_USER'),
      password: configService.getOrThrow<string>('DATABASE_PASSWORD'),
      database: configService.getOrThrow<string>('DATABASE_NAME'),
      port: parseInt(configService.getOrThrow<string>('DATABASE_PORT')),
      connectionLimit: 10,
      connectTimeout: 10000,
      ssl: { rejectUnauthorized: false },
    });

    super({ adapter });
  }

  async onModuleInit() {
    log('connecting...');
    await this.$connect();
    log('done.');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    log('disconnected.');
  }
}
