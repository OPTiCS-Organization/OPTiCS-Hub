import { Body, Controller, Param, Post, Req, Request, UseGuards } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { CreateWorkspace } from './dto/CreateWorkspace.dto';
import { ConnectWorkspace } from './dto/ConnectWorkspace.dto';

@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
  ) { }

  @Post('/status/heartbeat')
  handleHeartbeat(@Body() data) {
    this.workspaceService.handleHeartbeat(data)
  }

  @Post('/initialize')
  async handleInitializeServer(@Body() body, @Req() req) {
    const ip = req.headers['x-forwarded-for'] || req.ip;
    const data = await this.workspaceService.handleInitializeServer(body, ip);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        connectionCode: data,
      },
      message: 'Initialized Successfully.',
    }
    return response;
  }

  @Post('/workspace')
  @UseGuards(JwtGuard)
  async handleCreateWorkspace(@Request() request: any, @Body() body: CreateWorkspace) {
    const data = await this.workspaceService.handleCreateWorkspace(request.user.userIndex, body.workspaceName);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        createdAt: data.workspace_created_at
      },
      message: 'Created Successfully.',
    }
    return response;
  }

  /**
   * Todo 
   * 이미 연결된 에이전트에 다시 연결할 수 없도록 처리하기
   */
  @Post('/:workspaceIdx/connect')
  @UseGuards(JwtGuard)
  async handleConnectWorkspace(@Request() request: any, @Param('workspaceIdx') param: string, @Body() body: ConnectWorkspace) {
    const data = await this.workspaceService.handleConnectWorkspace(request.user.userIndex, parseInt(param), body.targetAgentCode);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Connected Successfully.',
    };
    return response;
  }
}
