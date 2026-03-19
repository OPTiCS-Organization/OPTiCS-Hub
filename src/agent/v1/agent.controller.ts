import { Body, Controller, Post } from '@nestjs/common';
import { AgentService } from '../agent.service';
import { HandleConnectRequest } from '../dto/HandleConnectRequest.dto';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';

@Controller({ path: 'agent', version: '1' })
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
  ) { };

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
