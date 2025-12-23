import { ConflictException, Injectable } from '@nestjs/common';
import { RegisterDTO } from './dto/register.dto';
import { prisma } from 'src/util/prisma.util';
import { Response } from 'express';
import { JwtUtil } from './jwt.util';
import bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { LoginDTO } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
  ) { };

  async register(dto: RegisterDTO) {
    if (await prisma.users.findFirst({ where: { user_email: dto.email } })) {
      throw new ConflictException('이미 사용중인 이메일입니다.');
    }

    const user = await prisma.users.create({
      data: {
        user_email: dto.email,
        user_display: dto.display,
        user_password: await bcrypt.hash(dto.password, parseInt(this.configService.getOrThrow('SECURITY_SALT_ROUND')))
      }
    });

    return await this.jwtUtil.sign(user.user_index);
  }

  async login(dto: LoginDTO) {
    const foundUser = await prisma.users.findFirstOrThrow({
      where: {
        user_email: dto.email
      },
    });

    if (!foundUser || !await bcrypt.compare(dto.password, foundUser.user_password)) {
      throw new ConflictException('일치하는 이메일과 패스워드를 찾지 못했습니다.');
    }

    return await this.jwtUtil.sign(foundUser.user_index);
  }
}
