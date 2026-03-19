import { Body, Controller, Delete, Get, Param, Post, Req, Request, UseGuards } from '@nestjs/common';
import { WorkspaceService } from '../workspace.service';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { CreateWorkspace } from '../dto/CreateWorkspace.dto';
import { ConnectWorkspace } from '../dto/ConnectWorkspace.dto';
import { CheckWorkspaceName } from '../dto/CheckWorkspaceName.dto';

@Controller({ path: 'workspace', version: '1' })
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
  ) { }

  @Post('status/heartbeat')
  handleHeartbeat(@Body() data) {
    this.workspaceService.handleHeartbeat(data)
  }

  @Post('initialize')
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

  @Post()
  @UseGuards(JwtGuard)
  async handleCreateWorkspace(@Request() request: any, @Body() body: CreateWorkspace) {
    const data = await this.workspaceService.handleCreateWorkspace(request.user.userIndex, body.workspaceName);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Created Successfully.',
    }
    return response;
  }

  @Post('check-workspace-name')
  @UseGuards(JwtGuard)
  async handleValidateWorkspaceName(@Request() request: any, @Body() body: CheckWorkspaceName) {
    const validation = await this.workspaceService.handleValidateWorkspace(request.user.userIndex, body.workspaceName);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        valid: validation,
      },
      message: validation === true ? 'This Workspace Name is Valid.' : 'This Workspace Name is Already Using.',
    }

    return response;
  }

  @Get()
  @UseGuards(JwtGuard)
  async handleGetWorkspaceList(@Request() request: any) {
    const data = await this.workspaceService.handleGetWorkspaceList(request.user.userIndex);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        workspaces: data
      },
      message: `Found ${data.length} Workspaces Successfully.`
    }

    return response
  }

  @Delete(':workspaceIdx')
  @UseGuards(JwtGuard)
  async handleDeleteWorkspace(@Request() request: any, @Param('workspaceIdx') param: string) {
    const data = await this.workspaceService.handleDeleteWorkspace(request.user.userIndex, parseInt(param))
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Deleted Workspace Successfully.'
    }

    return response;
  }

  @Post(':workspaceIdx/connect')
  @UseGuards(JwtGuard)
  async handleConnectAgent(@Request() request: any, @Param('workspaceIdx') param: string, @Body() body: ConnectWorkspace) {
    const data = await this.workspaceService.requestConnectWorkspaceAndAgent(request.user.userIndex, parseInt(param), body.targetAgentCode);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Connected Successfully.',
    };
    return response;
  }

  @Get(':workspaceName')
  @UseGuards(JwtGuard)
  async handleGetWorkspaceInformation(@Request() request: any, @Param('workspaceName') param: string) {
    const data = await this.workspaceService.handleGetWorkspaceInformation(request.user.userIndex, param);
    const response: GlobalResponse = {
      code: Code.Common.NOT_IMPLEMENTED,
      data: data,
      message: 'Not Implemented API. Please Request Later.'
    }
    return response;
  }
}