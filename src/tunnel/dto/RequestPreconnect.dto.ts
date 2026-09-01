import { IsInt, IsUUID, Matches } from "class-validator";

/**
 * 게이트웨이가 Agent에게서 받은 PRE 줄을 그대로 옮겨 담은 것.
 *
 * 신뢰할 수 없는 TCP 소켓에서 파싱한 값이므로 타입을 먼저 검사한다.
 * nonce는 randomBytes(16), signature는 sha256이라 각각 hex 32·64자로 고정된다.
 */
export class RequestPreconnect {
  @IsUUID()
  agentUuid: string;

  @IsInt()
  timestamp: number;

  @Matches(/^[0-9a-f]{32}$/i)
  nonce: string;

  @Matches(/^[0-9a-f]{64}$/i)
  signature: string;
}
