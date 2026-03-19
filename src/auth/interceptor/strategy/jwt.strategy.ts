import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => request?.cookies?.accessToken,
      ]),
      secretOrKey: configService.getOrThrow('SECURITY_JWT_SECRET'),
    });
  }

  async validate(payload: any): Promise<any> {
    const exist = await this.prismaService.users.findFirst({
      where: {
        user_index: payload.userIndex,
        user_restriction: false,
      },
    });

    if (!exist) {
      throw new UnauthorizedException({
        message: '인증 정보가 유효하지 않습니다.',
      });
    }

    const user = {
      userIndex: exist.user_index,
      userDisplay: exist.user_display,
      userEmail: exist.user_email,
      userPermission: exist.user_permission,
      userRestriction: exist.user_restriction,
    };

    return user;
  }
}
