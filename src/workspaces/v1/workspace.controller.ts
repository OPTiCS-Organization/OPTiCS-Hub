import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { WorkspaceService } from '../workspace.service';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { CreateWorkspace } from '../dto/CreateWorkspace.dto';
import { ConnectWorkspace } from '../dto/ConnectWorkspace.dto';
import { CheckWorkspaceName } from '../dto/CheckWorkspaceName.dto';
import { RedeployService } from '../dto/RedeployService.dto';
import { UpdateServiceSubdomain } from '../dto/UpdateServiceSubdomain.dto';

@Controller({ path: 'workspace', version: '1' })
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
  ) { }

  @Post('status/heartbeat')
  handleHeartbeat(@Body() data) {
    this.workspaceService.handleHeartbeat(data)
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
    const data = await this.workspaceService.requestConnectWorkspaceAndAgent(request.user.userIndex, parseInt(param), body.targetAgentCode, request.user.userDisplay);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Connect Request Sent. Please Check Agent-Side Dashboard.',
    };
    return response;
  }

  @Delete(':workspaceIdx/agent/:agentCode/disconnect')
  @UseGuards(JwtGuard)
  async handleDisconnectAgent(@Request() request: any, @Param('workspaceIdx') workspaceIdx: string, @Param('agentCode') agentCode: string) {
    const data = await this.workspaceService.disconnectWorkspaceAgent(request.user.userIndex, parseInt(workspaceIdx), agentCode);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Agent Disconnected Successfully.',
    };
    return response;
  }

  @Delete(':workspaceIdx/agent/:agentCode/cancel')
  @UseGuards(JwtGuard)
  async handleCancelAgentConnectionRequest(@Request() request: any, @Param('workspaceIdx') workspaceIdx: string, @Param('agentCode') agentCode: string) {
    const data = await this.workspaceService.cancelWorkspaceAgentConnectionRequest(request.user.userIndex, parseInt(workspaceIdx), agentCode);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        data
      },
      message: 'Agent Connection Request Cancelled Successfully.',
    };
    return response;
  }

  @Post('/services/deploy')
  @UseGuards(JwtGuard)
  async handleCreateService(@Request() request: any, @Body() body: any) {
    const data = await this.workspaceService.handleCreateService(request.user.userIndex, body);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Service Created Successfully.',
    };
    return response;
  }

  @Delete('/services/:serviceIdx')
  @UseGuards(JwtGuard)
  async handleDeleteService(@Request() request: any, @Param('serviceIdx') param: string, @Body() body: { deleteScope?: 'containers' | 'service' }) {
    const data = await this.workspaceService.handleDeleteService(request.user.userIndex, param, body?.deleteScope);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Delete Command Sent.',
    };
    return response;
  }

  @Post('/services/:serviceIdx/redeploy')
  @UseGuards(JwtGuard)
  async handleRedeployService(@Request() request: any, @Param('serviceIdx') param: string, @Body() body: RedeployService) {
    const data = await this.workspaceService.handleRedeployService(request.user.userIndex, param, body);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Redeploy Command Sent.',
    };
    return response;
  }

  @Post('/services/:serviceIdx/start')
  @UseGuards(JwtGuard)
  async handleStartService(@Request() request: any, @Param('serviceIdx') param: string) {
    const data = await this.workspaceService.handleStartService(request.user.userIndex, param)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        service: data,
      },
      message: 'Server Start Commend Sent.'
    }
    return response;
  }

  @Post('/services/:serviceIdx/stop')
  @UseGuards(JwtGuard)
  async handleStopService(@Request() request: any, @Param('serviceIdx') param: string) {
    const data = await this.workspaceService.handleStopService(request.user.userIndex, param)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        service: data,
      },
      message: 'Server Stop Command Sent.'
    }
    return response;
  }

  @Post('/services/:serviceIdx/containers/:containerName/start')
  @UseGuards(JwtGuard)
  async handleStartContainer(@Request() request: any, @Param('serviceIdx') serviceIdx: string, @Param('containerName') containerName: string) {
    const data = await this.workspaceService.handleStartContainer(request.user.userIndex, serviceIdx, containerName)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        container: data,
      },
      message: 'Container Start Command Sent.'
    }
    return response;
  }

  @Post('/services/:serviceIdx/containers/:containerName/stop')
  @UseGuards(JwtGuard)
  async handleStopContainer(@Request() request: any, @Param('serviceIdx') serviceIdx: string, @Param('containerName') containerName: string) {
    const data = await this.workspaceService.handleStopContainer(request.user.userIndex, serviceIdx, containerName)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        container: data,
      },
      message: 'Container Stop Command Sent.'
    }
    return response;
  }

  @Post('/services/:serviceIdx/containers/:containerName/restart')
  @UseGuards(JwtGuard)
  async handleRestartContainer(@Request() request: any, @Param('serviceIdx') serviceIdx: string, @Param('containerName') containerName: string) {
    const data = await this.workspaceService.handleRestartContainer(request.user.userIndex, serviceIdx, containerName)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        container: data,
      },
      message: 'Container Restart Command Sent.'
    }
    return response;
  }

  @Patch('/services/:serviceIdx/subdomain')
  @UseGuards(JwtGuard)
  async handleUpdateServiceSubdomain(@Request() request: any, @Param('serviceIdx') param: string, @Body() body: UpdateServiceSubdomain) {
    const data = await this.workspaceService.handleUpdateServiceSubdomain(request.user.userIndex, param, body.subdomain ?? null);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Subdomain Updated Successfully.',
    };
    return response;
  }

  @Get(':workspaceIdx/services')
  @UseGuards(JwtGuard)
  async handleGetServiceList(@Request() request: any, @Param('workspaceIdx') param: string) {
    const data = await this.workspaceService.handleGetServiceList(request.user.userIndex, parseInt(param));
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { services: data },
      message: `Found ${data.length} Services.`,
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
      message: 'Success.'
    }
    return response;
  }
}
