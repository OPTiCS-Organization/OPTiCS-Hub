import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import log from "spectra-log";
import { prisma } from "src/util/prisma.util";

@Injectable()
export class JwtUtil {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { };

  async sign(userIndex: number) {
    return this.printToken(userIndex);
  }

  async refresh(token: string) {
    const userIndex = this.jwtService.decode(token).userIndex;

    const exist = await prisma.refresh_token.findFirstOrThrow({
      where: {
        token_owner: userIndex,
        token: token,
      }
    }).catch(() => {
      throw new UnauthorizedException();
    })

    await prisma.refresh_token.update({
      where: {
        token_index: exist.token_index
      },
      data: {
        token_expired_at: new Date
      }
    });

    return this.printToken(userIndex);
  }

  private async printToken(userIndex: number) {
    const accessToken = await this.jwtService.signAsync({ userIndex }, {
      expiresIn: this.configService.getOrThrow('SECURITY_ACCESS_EXPIRE_TIME'),
    });

    const refreshToken = await this.jwtService.signAsync({ userIndex }, {
      expiresIn: this.configService.getOrThrow('SECURITY_REFRESH_EXPIRE_TIME'),
    });

    return { accessToken, refreshToken };
  }
}