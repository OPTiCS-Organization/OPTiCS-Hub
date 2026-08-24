import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AgentService } from '../agent.service';
import { AgentUpdateService } from '../agent-update.service';
import { HandleConnectRequest } from '../dto/HandleConnectRequest.dto';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';

@Controller({ path: 'agent', version: '1' })
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly agentUpdateService: AgentUpdateService,
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

  @Post('/:agentUuid/update')
  @UseGuards(JwtGuard)
  async handleRequestUpdate(@Param('agentUuid') agentUuid: string, @Body() body: { version: string }) {
    await this.agentUpdateService.requestUpdate(agentUuid, body.version);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Update requested.',
    };
    return response;
  }

  /** 성공/실패 배지를 사용자가 닫는다. 언제까지 띄울지는 서버가 정하지 않는다. */
  @Post('/:agentUuid/update/acknowledge')
  @UseGuards(JwtGuard)
  async handleAcknowledgeUpdate(@Param('agentUuid') agentUuid: string) {
    await this.agentUpdateService.acknowledge(agentUuid);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Acknowledged.',
    };
    return response;
  }

  @Post('/connect/accept')
  async handleAcceptConnectRequest(@Body() body: HandleConnectRequest) {
    await this.agentService.handleAcceptConnectRequest(body.agentCode, body.agentUuid);

    const response: GlobalResponse = {
      code: Code.Agent.REQUEST.CONNECTED,
      data: {},
      message: 'Accepted Connection Request.'
    }

    return response;
  }

  @Post('/connect/reject')
  async handleRejectConnectionRequest(@Body() body: HandleConnectRequest) {
    await this.agentService.handleRejectConnectRequest(body.agentCode, body.agentUuid);

    const response: GlobalResponse = {
      code: Code.Agent.REQUEST.CONNECTED,
      data: {},
      message: 'Rejected Connection Request.'
    }

    return response;
  }
}
