import { Controller, Get } from '@nestjs/common';
import { StatsService } from '../stats.service';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';

/**
 * 인증도 쿠키도 요구하지 않는 공개 API다(랜딩 사이트가 직접 호출). GET은 main.ts의
 * Origin 검사 미들웨어(ORIGIN_EXEMPT_METHODS)를 애초에 타지 않지만, 그건 "요청 실행"을
 * 막지 않는다는 뜻일 뿐이다. 브라우저가 응답 본문을 실제로 읽으려면 랜딩 사이트 Origin이
 * CORS_ORIGIN 환경변수(쉼표 구분 목록, src/global/origin.util.ts)에 들어 있어야 한다 —
 * 안 그러면 요청은 200으로 성공해도 브라우저가 CORS 오류로 응답을 감춘다.
 */
@Controller({ path: 'stats', version: '1' })
export class StatsController {
  constructor(
    private readonly statsService: StatsService,
  ) { }

  @Get('public')
  async handleGetPublicStats() {
    const data = await this.statsService.getPublicStats();
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data,
      message: 'Public platform stats.',
    };
    return response;
  }
}
