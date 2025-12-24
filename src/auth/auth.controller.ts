import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDTO } from './dto/register.dto';
import { LoginDTO } from './dto/login.dto';
import { CookieInterceptor } from 'src/global/Cookie.intercepter';
import { JwtGuard } from './interceptor/guard/jwt.guard';

@Controller('auth')
export class AuthController {
  constructor (
    private readonly authService: AuthService,
  ) { };
  
  @Post('/register')
  @UseInterceptors(CookieInterceptor)
  async register(@Body() body: RegisterDTO) {
    return await this.authService.register(body);
  }

  @Post('/login')
  @UseInterceptors(CookieInterceptor)
  async login(@Body() body: LoginDTO) {
    return await this.authService.login(body);     
  }

  @Post('/test')
  @UseGuards(JwtGuard)
  async testAPI() {
    return 'suka';
  }
}