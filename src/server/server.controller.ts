import { Body, Controller, Param, Post, Req, Request, UseGuards } from '@nestjs/common';
import { ServerService } from './server.service';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { CreateContainer } from './dto/CreateContainer.dto';
import { ConnectContainer } from './dto/ConnectContainer.dto';

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
  async handleInitializeServer(@Body() body, @Req() req) {
    const ip = req.headers['x-forwarded-for'] || req.ip;
    const data = await this.serverService.handleInitializeServer(body, ip);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        connectionCode: data,
      },
      message: 'Initialized Successfully.',
    }
    return response;
  }

  @Post('/container')
  @UseGuards(JwtGuard)
  async handleCreateContainer(@Request() request: any, @Body() body: CreateContainer) {
    const data = await this.serverService.handleCreateContainer(request.user.userIndex, body.containerName);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        createdAt: data.container_created_at
      },
      message: 'Created Successfully.',
    }
    return response;
  }

  @Post('/:containerIdx/connect')
  @UseGuards(JwtGuard)
  async handleConnectContainer(@Request() request: any, @Param('containerIdx') param: string, @Body() body: ConnectContainer) {
    const data = await this.serverService.handleConnectContainer(request.user.userIndex, parseInt(param), body.targetAgentCode)
  }
}
