import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class LoginDTO {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;

  /**
   * 2FA를 켠 계정만 필요, 첫 요청에서는 비워 보내고,
   * 서버가 TOTP_REQUIRED(A0F6)로 응답하면 코드를 담아 다시 보냅니다.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'TOTP code must be 6 digits.' })
  totpCode?: string;
}
