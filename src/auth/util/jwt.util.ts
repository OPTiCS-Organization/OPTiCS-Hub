import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { PrismaService } from "src/prisma.service";
import { TokenPurpose } from "../types/TokenPurpose.type";
import { TokenPayload } from "../types/TokenPayload.type";

type TokenTtl = NonNullable<JwtSignOptions['expiresIn']>;

const TOKEN_TTL_CONFIG: Record<TokenPurpose, string> = {
  [TokenPurpose.ACCESS]: 'SECURITY_ACCESS_TTL',
  [TokenPurpose.REFRESH]: 'SECURITY_REFRESH_TTL',
  [TokenPurpose.TERMINAL_SSH]: 'SECURITY_TERMINAL_SSH_TTL',
  [TokenPurpose.VERIFY_REGISTER_TOTP]: 'SECURITY_VERIFY_REGISTER_TOTP_TTL',
};

const LEGACY_TOKEN_TTL_CONFIG: Partial<Record<TokenPurpose, string>> = {
  [TokenPurpose.ACCESS]: 'SECURITY_ACCESS_EXPIRE_TIME',
  [TokenPurpose.REFRESH]: 'SECURITY_REFRESH_EXPIRE_TIME',
};

const DEFAULT_TOKEN_TTL: Partial<Record<TokenPurpose, TokenTtl>> = {
  [TokenPurpose.TERMINAL_SSH]: '2m',
  [TokenPurpose.VERIFY_REGISTER_TOTP]: '5m',
};
@Injectable()
export class JwtUtil {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) { };

  /** 저장된 Refresh Token을 폐기하고 새로운 로그인 토큰 쌍을 발급한다. */
  async refresh(token: string) {
    const userIndex = this.jwtService.decode(token).userIndex;

    const exist = await this.prismaService.refresh_token.findFirstOrThrow({
      where: {
        token_owner: userIndex,
        token: token,
        token_expired_at: null,
      }
    }).catch(() => {
      return null;
    })

    if (!exist) return { accessToken: null, refreshToken: null };

    await this.prismaService.refresh_token.update({
      where: {
        token_index: exist.token_index
      },
      data: {
        token_expired_at: new Date
      }
    });

    return this.signLoginTokens(userIndex);
  }

  /**
   * 로그아웃. 제시된 Refresh Token 을 폐기한다.
   *
   * Access Token 은 만료될 때까지 유효하지만 짧게 살고, 갱신은 Refresh Token 없이는
   * 불가능하므로 이 한 줄이 세션의 실질적인 끝이다. 이미 없거나 만료된 토큰이어도
   * 조용히 넘어간다 — 로그아웃은 몇 번을 눌러도 같은 결과여야 한다.
   */
  async revokeRefreshToken(token: string | undefined) {
    if (!token) return;

    const userIndex: number | undefined = this.jwtService.decode(token)?.userIndex;
    if (userIndex === undefined) return;

    await this.prismaService.refresh_token.updateMany({
      where: {
        token_owner: userIndex,
        token: token,
        token_expired_at: null,
      },
      data: {
        token_expired_at: new Date(),
      },
    });
  }

  /** 사용자 인증에 사용할 Access Token과 Refresh Token을 함께 발급한다. */
  public async signLoginTokens(userIndex: number) {
    const accessToken = await this.jwtService.signAsync({
      purpose: TokenPurpose.ACCESS,
      userIndex,
    }, {
      expiresIn: this.getTokenTtl(TokenPurpose.ACCESS),
    });

    const refreshToken = await this.jwtService.signAsync({
      purpose: TokenPurpose.REFRESH,
      userIndex,
    }, {
      expiresIn: this.getTokenTtl(TokenPurpose.REFRESH),
    });

    await this.prismaService.refresh_token.create({
      data: {
        token: refreshToken,
        token_owner: userIndex,
      }
    });

    return { accessToken, refreshToken };
  }

  /** 지정한 목적과 추가 claim을 포함한 단일 목적성 토큰을 발급한다. */
  async signPurposeToken(userIndex: number, purpose: TokenPurpose, claims: Record<string, unknown> = {}) {
    return this.jwtService.signAsync(
      {
        purpose,
        ...claims,
      },
      {
        subject: String(userIndex),
        jwtid: crypto.randomUUID(),
        expiresIn: this.getTokenTtl(purpose),
      },
    );
  };

  /** JWT의 유효성과 purpose가 기대한 용도와 일치하는지 검증한다. */
  async verifyPurposeToken(token: string, expectedPurpose: TokenPurpose) {
    const payload = await this.jwtService.verifyAsync<TokenPayload>(token);

    if (payload.purpose !== expectedPurpose) {
      throw new UnauthorizedException('Invalid token purpose.');
    }

    return payload;
  }

  /** 토큰 목적에 대응하는 환경 변수에서 TTL 설정을 가져온다. */
  private getTokenTtl(purpose: TokenPurpose): TokenTtl {
    const configKey = TOKEN_TTL_CONFIG[purpose];
    const configured = this.configService.get<TokenTtl>(configKey);
    if (configured) return configured;

    const legacyConfigKey = LEGACY_TOKEN_TTL_CONFIG[purpose];
    if (legacyConfigKey) return this.configService.getOrThrow<TokenTtl>(legacyConfigKey);

    const defaultTtl = DEFAULT_TOKEN_TTL[purpose];
    if (defaultTtl) return defaultTtl;

    return this.configService.getOrThrow<TokenTtl>(configKey);
  }
}
