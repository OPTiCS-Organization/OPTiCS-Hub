import { IsEnum, IsUUID, Matches } from 'class-validator';
import { TokenPurpose } from '../types/TokenPurpose.type';

export class MintPurposeTokenDTO {
  @IsEnum(TokenPurpose)
  purpose: TokenPurpose;

  @IsUUID()
  agentUuid: string;

  @Matches(/^\d{6}$/)
  totpCode: string;
}
