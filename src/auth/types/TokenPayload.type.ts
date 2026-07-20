import { TokenPurpose } from './TokenPurpose.type';

export type TokenPayload = {
  sub: string;
  purpose: TokenPurpose;
  jti: string;
  exp?: number;
  agentUuid?: string;
};
