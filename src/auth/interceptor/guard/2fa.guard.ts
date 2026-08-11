import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TwoFactorAuthenticationService } from 'src/auth/2fa.service';
import { PrismaService } from 'src/prisma.service';

type AuthenticatedRequest = Request & {
  user?: {
    userIndex?: number;
  };
  body?: {
    totpCode?: unknown;
  };
};

@Injectable()
export class TwoFactorGuard implements CanActivate {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly twoFactorAuthenticationService: TwoFactorAuthenticationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ExecutionContext는 현재 요청의 실행 정보를 가지고 있음. HTTP 요청에서는 Express Request로 꺼내서 사용한다.
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 이 가드는 JwtGuard가 요청을 처리한 이후 실행되어야 함. JwtGuard가 request.user를 주입해줌
    const userIndex = request.user?.userIndex;

    if (!userIndex) {
      throw new UnauthorizedException('Authentication is required.');
    }

    // 2FA가 꺼져 있는 계정은 기존 JWT 인증만으로 통과시킨다.
    const user = await this.prismaService.users.findUnique({
      where: {
        user_index: userIndex,
      },
      select: {
        user_totp_active: true,
      },
    });

    // 2FA가 활성화되지 않은 계정은 통과할 수 없음
    if (!user?.user_totp_active) {
      throw new ForbiddenException('Two Factor Authentication must be enabled.');
    }

    // 2FA가 켜진 계정은 요청 헤더나 바디에 포함된 TOTP 코드를 검증한다.
    const token = this.extractToken(request);
    await this.twoFactorAuthenticationService.verifyActiveUserTotp(
      userIndex,
      token,
    );

    return true;
  }

  private extractToken(request: AuthenticatedRequest): string {
    const value =
      request.headers['x-totp-code'] ??
      request.body?.totpCode

    if (Array.isArray(value)) {
      throw new BadRequestException('TOTP code must be a single value.');
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('TOTP code is required.');
    }

    return value.trim();
  }
}
