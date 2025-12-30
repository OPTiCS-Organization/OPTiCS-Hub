import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly configService: ConfigService
  ) {
    const adapter = new PrismaMariaDb({
      host: configService.getOrThrow('DATABASE_HOST'),
      user: configService.getOrThrow('DATABASE_USER'),
      password: configService.getOrThrow('DATABASE_PASSWORD'),
      database: configService.getOrThrow('DATABASE_NAME'),
      connectionLimit: 10,
      port: parseInt(configService.getOrThrow('DATABASE_PORT')),
    });

    super({ adapter });
  }


  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}