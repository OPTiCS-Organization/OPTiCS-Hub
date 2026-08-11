import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';

type TotpVerifySuccess = {
  epoch: number;
  timeStep?: number;
};

@Injectable()
export class TwoFactorAuthenticationService {
  private readonly epochToleranceSeconds: number;
  private readonly periodSeconds: number;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.epochToleranceSeconds = Number(
      configService.getOrThrow<string>('TOTP_EPOCH_TOLERANCE_SECONDS'),
    );
    this.periodSeconds = Number(configService.getOrThrow<string>('TOTP_PERIOD_SECONDS'));

    // 주기가 0이면 getTimeStep 이 0으로 나눠 Infinity 를 만들고 재사용 방지가 되지 않습니다.
    if (!Number.isFinite(this.periodSeconds) || this.periodSeconds <= 0) {
      throw new Error('TOTP_PERIOD_SECONDS must be a positive number.');
    }
    if (!Number.isFinite(this.epochToleranceSeconds) || this.epochToleranceSeconds < 0) {
      throw new Error('TOTP_EPOCH_TOLERANCE_SECONDS must be a non-negative number.');
    }
  }

  public async generate2FASecret(userEmail: string) {
    const user = await this.prismaService.users.findUnique({
      where: { user_email: userEmail },
      select: { user_totp_active: true },
    });

    // 이미 켜져 있으면 재등록을 방지합니다...
    // 2FA setup 호출만으로 TOTP 확인 없이 2FA가 비활성화되어 세션을 탈취한 쪽이 disconnect의 TOTP 코드 요구를 우회할 수 있습니다.
    if (user?.user_totp_active) {
      throw new ConflictException('Disable the existing 2FA before setting up a new one.');
    }

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

    // 시계 오차 허용 범위는 설정 값을 따르도록 합니다.
    const result = await verify({
      secret: user.user_totp_secret,
      token,
      epochTolerance: this.epochToleranceSeconds,
      // 마지막으로 성공한 time step 이하의 코드는 거절해서 같은 주기의 TOTP 코드 재사용을 방지합니다.
      afterTimeStep: user.last_used_totp_step ?? undefined,
    });

    log(`${result.valid}, `)

    if (!result.valid) {
      throw new UnauthorizedException('Invalid TOTP code.');
    }

    return result as typeof result & TotpVerifySuccess;
  }

  private getTimeStep(result: TotpVerifySuccess) {
    // otplib 런타임은 timeStep을 주지만 타입에 없을 수 있어서 epoch로 보정함.
    const step = result.timeStep ?? Math.floor(result.epoch / this.periodSeconds);

    if (!Number.isFinite(step)) {
      throw new InternalServerErrorException('Failed to resolve TOTP time step.');
    }

    return step;
  }
}
