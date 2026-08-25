import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ReleaseCatalogService } from '../release-catalog.service';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';

@Controller({ path: 'release', version: '1' })
export class ReleaseController {
  constructor(
    private readonly releaseCatalogService: ReleaseCatalogService,
  ) { }

  @Get('/agent')
  @UseGuards(JwtGuard)
  async handleListAgentReleases(@Query('channel') channel?: string) {
    const releases = await this.releaseCatalogService.listReleases(channel === 'beta');

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { releases },
      message: `Found ${releases.length} releases.`,
    };
    return response;
  }

  /** 캐시는 조회 시 자동 갱신되지만, 릴리즈 직후처럼 즉시 반영이 필요할 때 쓴다. */
  @Post('/agent/sync')
  @UseGuards(JwtGuard)
  async handleSyncAgentReleases() {
    await this.releaseCatalogService.sync();

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Release catalog synced.',
    };
    return response;
  }
}
