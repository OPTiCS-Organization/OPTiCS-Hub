import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { RegisterDTO } from './dto/register.dto';
import { CheckEmailDTO } from './dto/check-email.dto';
import { JwtUtil } from './util/jwt.util';
import bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { LoginDTO } from './dto/login.dto';
import { PrismaService } from 'src/prisma.service';
import { MintPurposeTokenDTO } from './dto/mintPurposeToken.dto';
import { TokenPurpose } from './types/TokenPurpose.type';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtUtil: JwtUtil,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

  async checkEmail(dto: CheckEmailDTO) {
    const user = await this.prismaService.users.findFirst({
      where: { user_email: dto.email },
    });
    return { exists: !!user };
  }

  async register(dto: RegisterDTO) {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('Password Confirm Does Not Match.');
    }

    if (
      await this.prismaService.users.findFirst({
        where: { user_email: dto.email },
      })
    ) {
      throw new ConflictException('Already Using Email.');
    }

    const user = await this.prismaService.users.create({
      data: {
        user_email: dto.email,
        user_display: dto.display,
        user_password: await bcrypt.hash(
          dto.password,
          parseInt(this.configService.getOrThrow('SECURITY_SALT_ROUND')),
        ),
      },
    });

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
