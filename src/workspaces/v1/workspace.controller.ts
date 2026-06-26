import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { WorkspaceService } from '../workspace.service';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { CreateWorkspace } from '../dto/CreateWorkspace.dto';
import { ConnectWorkspace } from '../dto/ConnectWorkspace.dto';
import { CheckWorkspaceName } from '../dto/CheckWorkspaceName.dto';
import { ToggleWorkspaceSubdomain } from '../dto/ToggleWorkspaceSubdomain.dto';
import { UpdateWorkspaceSubdomain } from '../dto/UpdateWorkspaceSubdomain.dto';
import { DeleteWorkspace } from '../dto/DeleteWorkspace.dto';

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
    const data = await this.workspaceService.handleCreateWorkspace(request.user.userIndex, body.workspaceName, body.workspaceSubdomain ?? null);
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
  async handleDeleteWorkspace(@Request() request: any, @Param('workspaceIdx') param: string, @Body() body: DeleteWorkspace) {
    const data = await this.workspaceService.handleDeleteWorkspace(request.user.userIndex, parseInt(param), request.user.userDisplay, body?.confirmation ?? '')
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

  @Patch(':workspaceIdx/subdomain')
  @UseGuards(JwtGuard)
  async handleUpdateWorkspaceSubdomain(@Request() request: any, @Param('workspaceIdx') param: string, @Body() body: UpdateWorkspaceSubdomain) {
    const data = await this.workspaceService.handleUpdateWorkspaceSubdomain(request.user.userIndex, parseInt(param), body.subdomain ?? null);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { workspace: data },
      message: 'Subdomain Updated Successfully.',
    };
    return response;
  }

  @Patch(':workspaceIdx/subdomain/active')
  @UseGuards(JwtGuard)
  async handleToggleWorkspaceSubdomain(@Request() request: any, @Param('workspaceIdx') param: string, @Body() body: ToggleWorkspaceSubdomain) {
    const data = await this.workspaceService.handleToggleWorkspaceSubdomain(request.user.userIndex, parseInt(param), body.active);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { workspace: data },
      message: body.active ? 'Subdomain Activated Successfully.' : 'Subdomain Deactivated Successfully.',
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
