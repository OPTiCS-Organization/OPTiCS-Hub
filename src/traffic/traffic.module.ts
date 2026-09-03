import { Module } from '@nestjs/common';
import { TrafficSyncService } from './traffic-sync.service';
import { UtilityModule } from 'src/utility/utility.module';

@Module({
  imports: [UtilityModule],
  providers: [TrafficSyncService],
  exports: [TrafficSyncService],
})
export class TrafficModule { }
