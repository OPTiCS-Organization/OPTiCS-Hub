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

      /**
       * 아래 세 옵션이 없으면 pool이 한 번 고갈된 뒤 영구히 복구되지 않는다.
       *
       * 드라이버 기본값은 queryTimeout=0, socketTimeout=0 즉 '무한 대기'다. 커넥션이
       * DB로 쿼리를 보낸 뒤 응답이 영영 오지 않으면(네트워크 단절, DB 재시작, 방화벽이
       * 유휴 TCP를 조용히 끊는 경우) 그 커넥션은 active 상태로 pool에 붙잡힌 채 절대
       * 반납되지 않는다. 이게 10번 쌓이면 active=10 idle=0 이 되고, 이후 모든 쿼리는
       * acquireTimeout(기본 10초)만 기다리다 'pool timeout'으로 죽는다. 재시작 전까지
       * 스스로 낫지 않는 이유가 이것이다.
       *
       * socketTimeout이 무응답 소켓을 끊어 커넥션을 pool로 되돌리고, queryTimeout이
       * 개별 쿼리가 무한정 매달리는 것을 막는다. 둘 다 acquireTimeout보다 넉넉히 크게
       * 잡아, 정상적으로 느린 쿼리가 타임아웃으로 오인되지 않게 한다.
       */
      socketTimeout: 60000,
      queryTimeout: 30000,

      /**
       * 커넥션이 30초 넘게 반납되지 않으면 경고 로그를 남긴다. 반납을 강제하지는 않고
       * 진단만 해준다 — 위 두 타임아웃이 실제 회수를 담당하고, 이 옵션은 만약 애플리케이션
       * 코드 쪽에 누수가 생겼을 때 그 사실을 조용히 묻히지 않게 드러내는 역할이다.
       * 켜두면 pool 관련 에러 메시지에 leak= 카운터도 함께 찍힌다.
       */
      leakDetectionTimeout: 30000,
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
