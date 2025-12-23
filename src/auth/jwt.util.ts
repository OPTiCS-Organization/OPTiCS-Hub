import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";

@Injectable()
export class JwtUtil {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { };

  async sign(userIndex: number) {
    const accessToken = await this.jwtService.signAsync({ userIndex }, {
      expiresIn: this.configService.getOrThrow('SECURITY_ACCESS_EXPIRE_TIME'),
    });

    const refreshToken = await this.jwtService.signAsync({ userIndex }, {
      expiresIn: this.configService.getOrThrow('SECURITY_REFRESH_EXPIRE_TIME'),
    });

    return { accessToken, refreshToken };
  }
}