import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AgentService } from '../agent.service';
import { HandleConnectRequest } from '../dto/HandleConnectRequest.dto';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';

@Controller({ path: 'agent', version: '1' })
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
  ) { };

  @Get('/workspace/:workspaceIdx')
  @UseGuards(JwtGuard)
  async handleGetAgentList(@Request() request: any, @Param('workspaceIdx') workspaceIdx: string) {
    const data = await this.agentService.getAgentList(request.user.userIndex as number, parseInt(workspaceIdx));
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { agents: data },
      message: `Found ${data.length} Agents.`,
    };
    return response;
  }

  @Post('/connect/accept')
  async handleAcceptConnectRequest(@Body() body: HandleConnectRequest) {
    await this.agentService.handleAcceptConnectRequest(body.agentCode);

    const response: GlobalResponse = {
      code: Code.Agent.REQUEST.CONNECTED,
      data: {},
      message: 'Accepted Connection Request.'
    }

    return response;
  }

  @Post('/connect/reject')
  async handleRejectConnectionRequest(@Body() body: HandleConnectRequest) {
    await this.agentService.handleRejectConnectRequest(body.agentCode);

    const response: GlobalResponse = {
      code: Code.Agent.REQUEST.CONNECTED,
      data: {},
      message: 'Rejected Connection Request.'
    }

    return response;
  }
}
