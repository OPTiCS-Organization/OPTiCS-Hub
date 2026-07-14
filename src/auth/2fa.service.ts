import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { PrismaService } from 'src/prisma.service';

const TOTP_EPOCH_TOLERANCE_SECONDS = 30;
const TOTP_PERIOD_SECONDS = 30;

type TotpVerifySuccess = {
  epoch: number;
  timeStep?: number;
};

@Injectable()
export class TwoFactorAuthenticationService {
  TOTP_EPOCH_TOLERANCE_SECONDS: number | undefined = undefined;
  TOTP_PERIOD_SECONDS: number | undefined = undefined;
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configSerivce: ConfigService,
  ) {
    this.TOTP_EPOCH_TOLERANCE_SECONDS = configSerivce.getOrThrow<number>("TOTP_EPOCH_TOLERANCE_SECONDS");
    this.TOTP_PERIOD_SECONDS = configSerivce.getOrThrow<number>("TOTP_EPOCH_TOLERANCE_SECONDS");
  }

  public async generate2FASecret(userEmail: string) {
    // 인증 앱에 등록할 사용자별 Base32 secret 생성.
    const secret = generateSecret();

    // Google Authenticator 계열 앱이 읽는 otpauth:// URI 생성.
    const otpUri = generateURI({
      issuer: 'OPTiCS Console',
      label: userEmail,
      secret,
    });

    // 프론트에서 바로 img src로 렌더링할 수 있는 QR Data URL 생성.
    const qrOtpUri = await QRCode.toDataURL(otpUri);

    // 등록 확정 전까지는 secret만 저장하고 활성화는 하지 않음.
    await this.prismaService.users.update({
      where: {
        user_email: userEmail,
      },
      data: {
        user_totp_secret: secret,
        user_totp_active: false,
        user_totp_active_at: null,
        last_used_totp_step: null,
      },
    });

    return {
      qrOtpUri,
      otpUri,
      secret,
    };
  }

  public async confirm2FA(userIndex: number, token: string) {
    // 사용자가 QR 등록 후 입력한 첫 코드를 검증해야 실제 2FA 활성화함.
    const result = await this.verifyUserTotp(userIndex, token, {
      requireActive: false,
    });

    await this.prismaService.users.update({
      where: {
        user_index: userIndex,
      },
      data: {
        user_totp_active: true,
        user_totp_active_at: new Date(),
        last_used_totp_step: this.getTimeStep(result),
      },
    });

    return true;
  }

  public async verifyActiveUserTotp(userIndex: number, token: string) {
    // 이미 활성화된 사용자만 로그인/민감 API 접근 시 검증함.
    const result = await this.verifyUserTotp(userIndex, token, {
      requireActive: true,
    });

    await this.prismaService.users.update({
      where: {
        user_index: userIndex,
      },
      data: {
        last_used_totp_step: this.getTimeStep(result),
      },
    });

    return true;
  }

  public async remove2FA(userIndex: number, token: string) {
    await this.verifyUserTotp(userIndex, token, {
      requireActive: true,
    });

    await this.prismaService.users.update({
      data: {
        user_totp_active: false,
        user_totp_secret: null,
        user_totp_active_at: null,
        last_used_totp_step: null,
      },
      where: {
        user_index: userIndex,
      },
    });
  }

  public async is2FAActive(userIndex: number) {
    const active = await this.prismaService.users.findUnique({
      where: {
        user_index: userIndex,
      },
      select: {
        user_totp_active: true,
        user_totp_active_at: true,
      },
    });

    return { isTotpActive: active?.user_totp_active, totpActivatedAt: active?.user_totp_active_at };
  }

  private async verifyUserTotp(
    userIndex: number,
    token: string,
    options: { requireActive: boolean },
  ) {
    // otplib 검증 전에 입력 형식을 먼저 제한해서 불필요한 검증 시도 줄임.
    if (!/^\d{6}$/.test(token)) {
      throw new BadRequestException('TOTP code must be 6 digits.');
    }

    // TOTP 검증에 필요한 값만 조회함.
    const user = await this.prismaService.users.findUnique({
      where: {
        user_index: userIndex,
      },
      select: {
        user_totp_secret: true,
        user_totp_active: true,
        last_used_totp_step: true,
      },
    });

    if (!user?.user_totp_secret) {
      throw new UnauthorizedException('TOTP is not configured.');
    }

    if (options.requireActive && !user.user_totp_active) {
      throw new UnauthorizedException('TOTP is not active.');
    }

    // 시계 오차는 앞뒤 30초까지 허용함.
    const result = await verify({
      secret: user.user_totp_secret,
      token,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
      // 마지막으로 성공한 time step 이하의 코드는 거절해서 같은 30초 코드 재사용 막음.
      afterTimeStep: user.last_used_totp_step ?? undefined,
    });

    if (!result.valid) {
      throw new UnauthorizedException('Invalid TOTP code.');
    }

    return result as typeof result & TotpVerifySuccess;
  }

  private getTimeStep(result: TotpVerifySuccess) {
    // otplib 런타임은 timeStep을 주지만 타입에 없을 수 있어서 epoch로 보정함.
    return result.timeStep ?? Math.floor(result.epoch / TOTP_PERIOD_SECONDS);
  }
}
