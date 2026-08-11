import { ForbiddenException, BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { UserPermission } from '@prisma/client';
import { RegisterDTO } from './dto/register.dto';
import { CheckEmailDTO } from './dto/check-email.dto';
import { JwtUtil } from './util/jwt.util';
import bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { LoginDTO } from './dto/login.dto';
import { PrismaService } from 'src/prisma.service';
import { MintPurposeTokenDTO } from './dto/mintPurposeToken.dto';
import { TokenPurpose } from './types/TokenPurpose.type';
import { MailerService } from 'src/mailer/mailer.service';
import { VerifyEmailDTO } from './dto/verify.dto';
import { IsValidVerificationCodeDTO } from './dto/isValidVerificationCode.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly mailerService: MailerService,
  ) {}

  async checkEmail(dto: CheckEmailDTO) {
    const user = await this.prismaService.users.findFirst({
      where: { user_email: dto.email },
    });
    return { exists: !!user };
  }

  async verifyEmail(dto: VerifyEmailDTO) {
    const user = await this.prismaService.users.findFirst({
      where: {
        user_email: dto.email,
      },
    });

    if (user) throw new ConflictException('Already exists');

    const verification = await this.issueOrReuseVerification(dto.email);

    // 메일에 표시할 "요청 시각"은 발급 시각이다. 재전송이어도 최초 발급 시각을 보여줘야
    // 본문의 "요청 시각 기준 N분간 유효" 안내와 실제 만료가 일치한다.
    await this.mailerService.sendVerification(
      dto.email,
      verification.verification_code,
      verification.verification_created_at,
    );

    return;
  }

  /**
   * 인증 코드를 발급하거나, 아직 쓸 만한 코드가 있으면 그것을 재사용합니다.
   * 쿨다운에 걸리면 429를 던집니다.
   *
   * 신규 가입과 기존 사용자 인증이 같은 정책을 쓰므로 여기 한 곳에 모읍니다.
   */
  private async issueOrReuseVerification(email: string) {
    // 재발송 제한. 마지막으로 보낸 시각이 기준이다.
    const cooldownSeconds = this.configService.getOrThrow<number>('mail.verificationResendCooldownSeconds');

    const lastSent = await this.prismaService.verification.findFirst({
      where: { verification_email: email },
      orderBy: { verification_last_sent_at: 'desc' },
    });

    if (lastSent) {
      const elapsedMs = Date.now() - lastSent.verification_last_sent_at.getTime();
      const remainingSeconds = Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000);

      if (remainingSeconds > 0) {
        // 남은 시간을 함께 알려줘야 콘솔이 카운트다운을 띄울 수 있다.
        throw new HttpException(
          { message: 'Please wait before requesting another verification email.', retryAfterSeconds: remainingSeconds },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // 아직 만료되지 않은 인증코드가 있으면 해당 코드를 다시 보낸다.
    // 단, 남은 유효시간이 쿨다운보다 짧으면 재사용하지 않고 새로 발급한다.
    const reusableAfter = new Date(this.verificationIssuedAfter().getTime() + cooldownSeconds * 1000);

    const reusable = await this.prismaService.verification.findFirst({
      where: {
        verification_email: email,
        verification_consumed_at: null,
        verification_created_at: { gte: reusableAfter },
      },
      orderBy: { verification_created_at: 'desc' },
    });

    const verification = reusable
      ? await this.prismaService.verification.update({
          where: { verification_index: reusable.verification_index },
          // 코드와 발급 시각은 그대로 둔다. 만료는 최초 발급 시각 기준이어야 하기 때문.
          data: { verification_last_sent_at: new Date() },
        })
      : await this.prismaService.verification.create({
          data: {
            verification_email: email,
            verification_code: crypto.randomUUID(),
          },
        });

    if (!verification) throw new InternalServerErrorException('Failed to creating verification. Please try again later.');

    return verification;
  }

  /**
   * 이메일 인증 도입 이전에 가입한 기존 사용자가 자기 주소로 인증 메일을 요청합니다.
   *
   * 대상 주소를 요청 본문이 아니라 로그인 토큰에서 가져옵니다.
   * 본문으로 받으면 아무나 남의 가입 주소로 메일을 보낼 수 있습니다.
   */
  async requestExistingEmailVerification(userIndex: number) {
    const user = await this.prismaService.users.findFirst({
      where: { user_index: userIndex },
    });

    if (!user) throw new UnauthorizedException('User Not Found.');

    if (user.user_permission !== UserPermission.unverified) {
      throw new ConflictException('Email Already Verified.');
    }

    const verification = await this.issueOrReuseVerification(user.user_email);

    await this.mailerService.sendVerificationForExisting(
      user.user_email,
      verification.verification_code,
      verification.verification_created_at,
    );

    return;
  }

  /**
   * 기존 사용자가 메일로 받은 코드로 인증을 완료합니다.
   *
   * 로그인 상태를 요구하지 않습니다. 코드 자체가 메일함 소유를 증명하고,
   * 사용자가 메일을 연 기기에서 바로 링크를 누를 수 있어야 하기 때문입니다.
   */
  async verifyExistingEmail(dto: IsValidVerificationCodeDTO) {
    const verification = await this.prismaService.verification.findFirst({
      where: {
        verification_code: dto.verificationCode,
        verification_consumed_at: null,
        verification_created_at: { gte: this.verificationIssuedAfter() },
      },
      orderBy: { verification_created_at: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or Expired Verification Code.');
    }

    const user = await this.prismaService.users.findFirst({
      where: { user_email: verification.verification_email },
    });

    // 코드는 유효한데 계정이 없다면 신규 가입용 코드다. 이 경로로 처리하면 안 된다.
    if (!user) throw new BadRequestException('No Account For This Verification Code.');

    // 권한 승격과 코드 소진은 한 트랜잭션이어야 한다.
    // 따로 하면 소진 처리가 실패했을 때 이미 쓴 코드가 계속 유효하게 남는다.
    await this.prismaService.$transaction([
      this.prismaService.users.update({
        where: { user_index: user.user_index },
        data: { user_permission: UserPermission.verified },
      }),
      this.prismaService.verification.update({
        where: { verification_index: verification.verification_index },
        data: { verification_consumed_at: new Date() },
      }),
    ]);

    return { email: user.user_email };
  }

  /**
   * 인증 코드 만료 기준 시각. 이 시각 이후에 발급된 코드만 유효합니다.
   *
   * TTL은 메일 본문에 "N분 후 만료"라고 표시하는 값과 같은 출처(mail 네임스페이스)에서 읽습니다.
   */
  private verificationIssuedAfter() {
    const ttlMinutes = this.configService.getOrThrow<number>('mail.verificationTtlMinutes');
    return new Date(Date.now() - ttlMinutes * 60_000);
  }

  async isValidVerificationCode(dto: IsValidVerificationCodeDTO) {
    const issuedAfter = this.verificationIssuedAfter();

    // 만료된 링크"와 "잘못된 링크"를 구분해 안내하기 위해 만료·사용됨을 조건에 넣지 않고 코드만으로 먼저 찾는다.
    const verification = await this.prismaService.verification.findFirst({
      where: { verification_code: dto.verificationCode },
      orderBy: { verification_created_at: 'desc' },
    });

    if (!verification) return { valid: false, reason: 'not_found' as const };
    if (verification.verification_consumed_at) return { valid: false, reason: 'consumed' as const };
    if (verification.verification_created_at < issuedAfter) return { valid: false, reason: 'expired' as const };

    return { valid: true, email: verification.verification_email };
  }

  async register(dto: RegisterDTO) {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('Password Confirm Does Not Match.');
    }

    const verification = await this.prismaService.verification.findFirst({
      where: {
        verification_code: dto.verificationCode,
        verification_consumed_at: null,
        verification_created_at: {
          gte: this.verificationIssuedAfter()
        },
      },
      orderBy: { verification_created_at: 'desc' },
    });

    if (!verification) {
      throw new BadRequestException('Invalid or Expired Verification Code.');
    }

    const email = verification.verification_email;

    if (await this.prismaService.users.findFirst({ where: { user_email: email } })) {
      throw new ConflictException('Already Using Email.');
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      parseInt(this.configService.getOrThrow('SECURITY_SALT_ROUND')),
    );

    // 계정 생성과 코드 소진은 한 트랜잭션이어야 한다.
    // 따로 하면 소진 처리가 실패했을 때 이미 쓴 코드가 계속 유효하게 남는다.
    const [user] = await this.prismaService.$transaction([
      this.prismaService.users.create({
        data: {
          user_email: email,
          user_display: dto.display,
          user_password: hashedPassword,
        },
      }),
      this.prismaService.verification.update({
        where: { verification_index: verification.verification_index },
        data: { verification_consumed_at: new Date() },
      }),
    ]);

    return await this.jwtUtil.signLoginTokens(user.user_index);
  }

  async login(dto: LoginDTO) {
    const foundUser = await this.prismaService.users.findFirst({
      where: {
        user_email: dto.email,
      },
    });

    if (
      !foundUser ||
      !(await bcrypt.compare(dto.password, foundUser.user_password))
    ) {
      throw new ConflictException(
        'Matching Email and Password Not Found.',
      );
    }

    return await this.jwtUtil.signLoginTokens(foundUser.user_index);
  }

  async mintPurposeToken(userIndex: number, dto: MintPurposeTokenDTO) {
    if (dto.purpose !== TokenPurpose.TERMINAL_SSH) {
      throw new BadRequestException('Unsupported token purpose.');
    }

    const agent = await this.prismaService.agents.findFirst({
      where: {
        agent_uuid: dto.agentUuid,
        agent_connection: 'linked',
        agent_deleted_at: null,
        parent: {
          workspace_owner: userIndex,
          workspace_deleted_at: null,
        },
      },
      select: { agent_uuid: true },
    });

    if (!agent) {
      throw new ForbiddenException('Agent access denied.');
    }

    return this.jwtUtil.signPurposeToken(userIndex, dto.purpose, {
      agentUuid: agent.agent_uuid,
    });
  }
}
