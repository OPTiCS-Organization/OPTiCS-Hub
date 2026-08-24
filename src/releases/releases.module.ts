import { Module } from '@nestjs/common';
import { ReleaseCatalogService } from './release-catalog.service';
import { ReleaseController } from './v1/release.controller';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ReleaseController],
  providers: [ReleaseCatalogService],
  exports: [ReleaseCatalogService],
})
export class ReleasesModule { }
