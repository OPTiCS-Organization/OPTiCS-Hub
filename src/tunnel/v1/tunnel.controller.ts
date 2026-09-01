import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { RequestConnect } from '../dto/RequestConnect.dto';
import { RequestPreconnect } from '../dto/RequestPreconnect.dto';
import { TunnelService } from '../tunnel.service';
import { InternalSecretGuard } from 'src/auth/interceptor/guard/InternalSecret.guard';

@Controller({ path: 'tunnel', version: '1' })
export class TunnelController {
  constructor (
    private readonly tunnelService: TunnelService,
  ) { };

  /**
   * 게이트웨이가 받은 PRE 줄을 검증해 준다.
   *
   * 거절도 200으로 돌려주고 본문의 ok로 가른다. 게이트웨이는 이 사유를 Agent에게
   * 그대로 흘려보내고, Agent는 재시도할 값어치가 있는지를 사유로 판단한다.
   */
  @Post('preconnect')
  @UseGuards(InternalSecretGuard)
  async preconnect(@Body() request: RequestPreconnect) {
    return await this.tunnelService.verifyPreconnect(request);
  }

  @Post('connect')
  @UseGuards(InternalSecretGuard)
  async connect(
    @Body() request: RequestConnect,
    @Headers('x-request-id') requestId?: string,
  ) {
    const diagnosticRequestId = requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
      ? requestId
      : request.token;
    return await this.tunnelService.sendProxyInfo(
      request.serviceSubdomain,
      request.workspaceSubdomain,
      request.token,
      diagnosticRequestId,
      request.preferPooled ?? false,
    );
  }
}
