import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { StatsController } from './v1/stats.controller';
import { TrafficModule } from 'src/traffic/traffic.module';

/**
 * TrafficModule을 여기서 import하는 이유: StatsService 자체는 PrismaService로 traffic_daily를
 * 읽기만 할 뿐 TrafficSyncService를 직접 주입받지 않는다. 하지만 그 동기화 잡이 어딘가의
 * 모듈 그래프에 실제로 올라가 있어야 OnModuleInit이 돌아 테이블이 채워진다. 공개 통계를
 * 소유한 모듈이 그 트래픽 숫자를 채우는 잡도 함께 끌고 오는 편이 자연스럽다.
 */
@Module({
  imports: [TrafficModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule { }
