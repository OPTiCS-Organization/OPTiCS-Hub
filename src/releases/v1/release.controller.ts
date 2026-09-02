import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ReleaseCatalogService } from '../release-catalog.service';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { UserPermission } from '@prisma/client';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { PermissionGuard } from 'src/auth/interceptor/guard/permission.guard';
import { RequirePermission } from 'src/auth/interceptor/decorator/permission.decorator';

/** 사용자에게 그대로 보이는 문구라 길이를 제한한다. 목록 한 줄에 들어가야 한다. */
const MAX_BLOCK_REASON_LENGTH = 200;

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

  /**
   * 문제가 확인된 버전의 설치를 막는다.
   *
   * 사고 대응용이라 즉시 반영되어야 하므로 동기화를 기다리지 않는다.
   * reason은 Console 목록과 업데이트 거부 응답에 그대로 노출된다.
   */
  @Post('/agent/:version/block')
  @UseGuards(JwtGuard, PermissionGuard)
  @RequirePermission(UserPermission.administrator)
  async handleBlockAgentRelease(
    @Param('version') version: string,
    @Body() body: { reason?: string },
  ) {
    const reason = body?.reason?.trim();
    if (!reason) {
      throw new BadRequestException('차단 사유(reason)가 필요합니다.');
    }
    if (reason.length > MAX_BLOCK_REASON_LENGTH) {
      throw new BadRequestException(`차단 사유는 ${MAX_BLOCK_REASON_LENGTH}자를 넘을 수 없습니다.`);
    }

    await this.releaseCatalogService.blockRelease(version, reason);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { version, reason },
      message: `Blocked agent release ${version}.`,
    };
    return response;
  }

  /** 운영자 차단만 해제한다. 회수나 프로토콜 때문에 막힌 버전은 계속 막힌 채로 남는다. */
  @Delete('/agent/:version/block')
  @UseGuards(JwtGuard, PermissionGuard)
  @RequirePermission(UserPermission.administrator)
  async handleUnblockAgentRelease(@Param('version') version: string) {
    await this.releaseCatalogService.unblockRelease(version);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { version },
      message: `Unblocked agent release ${version}.`,
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
