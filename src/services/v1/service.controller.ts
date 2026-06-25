import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ServiceService } from '../service.service';
import { JwtGuard } from 'src/auth/interceptor/guard/jwt.guard';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { RedeployService } from '../dto/RedeployService.dto';
import { UpdateServiceSubdomain } from '../dto/UpdateServiceSubdomain.dto';

@Controller({ path: 'service', version: '1' })
export class ServiceController {
  constructor(
    private readonly serviceService: ServiceService,
  ) { }

  @Post('deploy')
  @UseGuards(JwtGuard)
  async handleCreateService(@Request() request: any, @Body() body: any) {
    const data = await this.serviceService.handleCreateService(request.user.userIndex, body);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Service Created Successfully.',
    };
    return response;
  }

  @Get('workspace/:workspaceIdx')
  @UseGuards(JwtGuard)
  async handleGetServiceList(@Request() request: any, @Param('workspaceIdx') param: string) {
    const data = await this.serviceService.handleGetServiceList(request.user.userIndex, parseInt(param));
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { services: data },
      message: `Found ${data.length} Services.`,
    };
    return response;
  }

  @Delete(':serviceIdx')
  @UseGuards(JwtGuard)
  async handleDeleteService(@Request() request: any, @Param('serviceIdx') param: string, @Body() body: { deleteScope?: 'containers' | 'service' }) {
    const data = await this.serviceService.handleDeleteService(request.user.userIndex, param, body?.deleteScope);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Delete Command Sent.',
    };
    return response;
  }

  @Post(':serviceIdx/redeploy')
  @UseGuards(JwtGuard)
  async handleRedeployService(@Request() request: any, @Param('serviceIdx') param: string, @Body() body: RedeployService) {
    const data = await this.serviceService.handleRedeployService(request.user.userIndex, param, body);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Redeploy Command Sent.',
    };
    return response;
  }

  @Post(':serviceIdx/start')
  @UseGuards(JwtGuard)
  async handleStartService(@Request() request: any, @Param('serviceIdx') param: string) {
    const data = await this.serviceService.handleStartService(request.user.userIndex, param)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        service: data,
      },
      message: 'Server Start Commend Sent.'
    }
    return response;
  }

  @Post(':serviceIdx/stop')
  @UseGuards(JwtGuard)
  async handleStopService(@Request() request: any, @Param('serviceIdx') param: string) {
    const data = await this.serviceService.handleStopService(request.user.userIndex, param)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        service: data,
      },
      message: 'Server Stop Command Sent.'
    }
    return response;
  }

  @Post(':serviceIdx/containers/:containerName/start')
  @UseGuards(JwtGuard)
  async handleStartContainer(@Request() request: any, @Param('serviceIdx') serviceIdx: string, @Param('containerName') containerName: string) {
    const data = await this.serviceService.handleStartContainer(request.user.userIndex, serviceIdx, containerName)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        container: data,
      },
      message: 'Container Start Command Sent.'
    }
    return response;
  }

  @Post(':serviceIdx/containers/:containerName/stop')
  @UseGuards(JwtGuard)
  async handleStopContainer(@Request() request: any, @Param('serviceIdx') serviceIdx: string, @Param('containerName') containerName: string) {
    const data = await this.serviceService.handleStopContainer(request.user.userIndex, serviceIdx, containerName)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        container: data,
      },
      message: 'Container Stop Command Sent.'
    }
    return response;
  }

  @Post(':serviceIdx/containers/:containerName/restart')
  @UseGuards(JwtGuard)
  async handleRestartContainer(@Request() request: any, @Param('serviceIdx') serviceIdx: string, @Param('containerName') containerName: string) {
    const data = await this.serviceService.handleRestartContainer(request.user.userIndex, serviceIdx, containerName)
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        container: data,
      },
      message: 'Container Restart Command Sent.'
    }
    return response;
  }

  @Patch(':serviceIdx/subdomain')
  @UseGuards(JwtGuard)
  async handleUpdateServiceSubdomain(@Request() request: any, @Param('serviceIdx') param: string, @Body() body: UpdateServiceSubdomain) {
    const data = await this.serviceService.handleUpdateServiceSubdomain(request.user.userIndex, param, body.subdomain ?? null);
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: { service: data },
      message: 'Subdomain Updated Successfully.',
    };
    return response;
  }
}
