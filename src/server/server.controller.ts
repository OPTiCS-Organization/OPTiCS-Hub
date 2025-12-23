import { Body, Controller, Ip, Post, Req } from '@nestjs/common';
import { ServerService } from './server.service';

@Controller('server')
export class ServerController {
  constructor(
    private readonly serverService: ServerService,
  ) { }

  @Post('/status/heartbeat')
  handleHeartbeat(@Body() data) {
    this.serverService.handleHeartbeat(data)
  }

  @Post('/initialize')
  async handleInitializeServer(@Body() data, @Req() req) {
    const ip = req.headers['x-forwarded-for'] || req.ip;
    const response = await this.serverService.handleInitializeServer(data, ip);
    return { connectionCode: response };
  }

  @Post('/container')
  async handleCreateContainer() {
    
  }
}
