import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, VerifiedCallback } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { prisma } from "src/util/prisma.util";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([(request) => request?.cookies?.accessToken]),
      secretOrKey: configService.getOrThrow('SECURITY_JWT_SECRET'),
    });
  }

  async validate(payload: any, done: VerifiedCallback): Promise<any> {
    const exist = await prisma.users.findFirst({
      where: {
        user_index: payload.userIndex,
        user_restriction: false,
      }
    });

    if (!exist) {
      return done(new UnauthorizedException({ message: '인증 정보가 유효하지 않습니다.' }), false)
    }

    const user = {
      userIndex: exist.user_index,
      userEmail: exist.user_email,
      userPermission: exist.user_permission,
      userRestriction: exist.user_restriction
    }

    return done(null, user);
  }
}