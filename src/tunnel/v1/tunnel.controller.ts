import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RequestConnect } from '../dto/RequestConnect.dto';
import { TunnelService } from '../tunnel.service';
import { InternalSecretGuard } from 'src/auth/interceptor/guard/InternalSecret.guard';

@Controller({ path: 'tunnel', version: '1' })
export class TunnelController {
  constructor (
    private readonly tunnelService: TunnelService,
  ) { };

  @Post('connect')
  @UseGuards(InternalSecretGuard)
  async connect(@Body() request: RequestConnect) {
    return await this.tunnelService.sendProxyInfo(request.serviceSubdomain, request.workspaceSubdomain, request.token);
  }
}
