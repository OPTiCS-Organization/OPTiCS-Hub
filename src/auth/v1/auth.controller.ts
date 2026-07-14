import { BadRequestException, Body, Controller, Delete, Get, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { TwoFactorAuthenticationService } from '../2fa.service';
import { AuthService } from '../auth.service';
import { RegisterDTO } from '../dto/register.dto';
import { LoginDTO } from '../dto/login.dto';
import { CheckEmailDTO } from '../dto/check-email.dto';
import { CookieInterceptor } from 'src/global/Cookie.intercepter';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { JwtGuard } from '../interceptor/guard/jwt.guard';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorAuthenticationService: TwoFactorAuthenticationService,
  ) { }

  @Post('check-email')
  async checkEmail(@Body() body: CheckEmailDTO): Promise<{ exists: boolean }> {
    return await this.authService.checkEmail(body);
  }

  @Post('register')
  @UseInterceptors(CookieInterceptor)
  async register(@Body() body: RegisterDTO) {
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Register and Logged In Successfully.',
    };

    const tokens = await this.authService.register(body);
    return { ...tokens, ...response }
  }

  @Post('login')
  @UseInterceptors(CookieInterceptor)
  async login(@Body() body: LoginDTO) {
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Logged In Successfully.',
    };

    const tokens = await this.authService.login(body);
    return { ...tokens, ...response }
  }

  @Post('2fa/setup')
  @UseGuards(JwtGuard)
  async setupTwoFactorAuthentication(@Request() request: any) {
    const { qrOtpUri, secret } = await this.twoFactorAuthenticationService.generate2FASecret(
      request.user.userEmail,
    );

    return {
      code: Code.Common.SUCCESS,
      data: { qrOtpUri, secret },
      message: 'Two-factor authentication setup is ready.',
    };
  }

  @Post('2fa/confirm')
  @UseGuards(JwtGuard)
  async confirmTwoFactorAuthentication(
    @Request() request: any,
    @Body('totpCode') token: unknown,
  ) {
    if (typeof token !== 'string') {
      throw new BadRequestException('TOTP code must be a string.');
    }

    await this.twoFactorAuthenticationService.confirm2FA(
      request.user.userIndex,
      token.trim(),
    );

    return {
      code: Code.Common.SUCCESS,
      data: { active: true },
      message: 'Two-factor authentication is enabled.',
    };
  }

  @Delete('2fa/disconnect')
  @UseGuards(JwtGuard)
  async removeTwoFactorAuthentication(@Request() request: any, @Body('totpCode') token: unknown) {
    if (typeof token !== 'string') throw new BadRequestException('TOTP code must be a string.');

    await this.twoFactorAuthenticationService.remove2FA(request.user.userIndex, token.trim());

    return {
      code: Code.Common.SUCCESS,
      data: { active: false },
      message: 'Two-factor authentication is disabled.',
    };
  }

  @Get('2fa')
  @UseGuards(JwtGuard)
  async isTwoFactorAuthenticationActive(@Request() request: any) {
    const response = await this.twoFactorAuthenticationService.is2FAActive(request.user.userIndex);

    return {
      code: Code.Common.SUCCESS,
      data: response,
      message: 'OK',
    };
  }

  @Get('me')
  @UseGuards(JwtGuard)
  async credentials(@Request() request: any) {
    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {
        user: {
          userDisplay: request.user.userDisplay,
          userEmail: request.user.userEmail,
        },
      },
      message: 'Verified.'
    }

    return response
  }
}
