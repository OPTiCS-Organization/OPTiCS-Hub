import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDTO } from './dto/register.dto';
import { LoginDTO } from './dto/login.dto';
import { CheckEmailDTO } from './dto/check-email.dto';
import { CookieInterceptor } from 'src/global/Cookie.intercepter';
import { GlobalResponse } from 'src/global/GlobalResponse.dto';
import { Code } from 'src/global/Code.enum';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/check-email')
  async checkEmail(@Body() body: CheckEmailDTO): Promise<{ exists: boolean }> {
    return await this.authService.checkEmail(body);
  }

  @Post('/register')
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

  @Post('/login')
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
}
