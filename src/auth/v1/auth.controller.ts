import { Body, Controller, Get, Post, Request, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { RegisterDTO } from '../dto/register.dto';
import { LoginDTO } from '../dto/login.dto';
import { CheckEmailDTO } from '../dto/check-email.dto';
import { VerifyEmailDTO } from '../dto/verify.dto';
import { IsValidVerificationCodeDTO } from '../dto/isValidVerificationCode.dto';
import { CookieInterceptor } from 'src/global/Cookie.intercepter';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';
import { JwtGuard } from '../interceptor/guard/jwt.guard';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('check-email')
  async checkEmail(@Body() body: CheckEmailDTO): Promise<{ exists: boolean }> {
    return await this.authService.checkEmail(body);
  }

  /** 가입하려는 주소로 인증 메일을 보낸다. 쿨다운 중이면 429 와 남은 초를 돌려준다. */
  @Post('verify-email')
  async verifyEmail(@Body() body: VerifyEmailDTO) {
    await this.authService.verifyEmail(body);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Verification Email Sent.',
    };

    return response;
  }

  /** 메일 링크의 코드가 아직 쓸 수 있는지 확인한다. 가입 폼을 띄우기 전에 호출한다. */
  @Post('is-valid-verification-code')
  async isValidVerificationCode(@Body() body: IsValidVerificationCodeDTO) {
    const result = await this.authService.isValidVerificationCode(body);

    // 만료·오타는 정상적인 사용자 흐름이라 에러가 아니라 결과로 돌려준다.
    // 콘솔이 reason 에 따라 "재발송" 같은 다음 행동을 안내할 수 있다.
    const response: GlobalResponse = {
      code: result.valid ? Code.Common.SUCCESS : Code.Common.FAIL,
      data: result,
      message: result.valid ? 'Valid Verification Code.' : 'Invalid Verification Code.',
    };

    return response;
  }

  /**
   * 이메일 인증 도입 이전에 가입한 사용자가 자기 주소로 인증 메일을 요청한다.
   * 대상 주소는 본문이 아니라 로그인 토큰에서 가져오므로 JwtGuard 가 필수다.
   */
  @Post('request-existing-verification')
  @UseGuards(JwtGuard)
  async requestExistingVerification(@Request() request: any) {
    await this.authService.requestExistingEmailVerification(request.user.userIndex);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: {},
      message: 'Verification Email Sent.',
    };

    return response;
  }

  /** 기존 사용자가 메일로 받은 코드로 인증을 완료한다. 로그인 상태를 요구하지 않는다. */
  @Post('verify-existing-email')
  async verifyExistingEmail(@Body() body: IsValidVerificationCodeDTO) {
    const result = await this.authService.verifyExistingEmail(body);

    const response: GlobalResponse = {
      code: Code.Common.SUCCESS,
      data: result,
      message: 'Email Verified.',
    };

    return response;
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
