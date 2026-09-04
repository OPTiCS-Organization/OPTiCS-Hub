/*
 * 터널 연결 시도의 실패 원인을 나타내는 공용 상수입니다.
 *
 * Hub는 원인을 정확히 알고 있지만 HTTP 상태 코드로는 명확히 표현할 수 없습니다.
 * (workspace/service/agent 미존재가 모두 404로 처리됨) 그래서 실패 응답 본문에
 * 이 값을 실어 보내고, 게이트웨이는 상태 코드 대신 이 값 하나로 분기해서
 * 어떤 오류 페이지를 어떤 문구로 그릴지 정합니다.
 *
 * 게이트웨이 자신이 판정하는 원인(라우팅 실패, Hub 도달 실패, 터널 미도착)도 상수에 포함해서 모든 상태 분기를 이곳에서 담당합니다.
 *
 * 이 파일은 Nest(src)와 게이트웨이(proxy/tunnel) 양쪽에서 함께 쓰므로 런타임 의존성 없이 순수 상수만 둡니다.
 */

export const TUNNEL_OUTCOME = {
  SUCCESS: 'success',

  // --- Hub가 판정하는 원인 ---
  /** 해당 서브도메인으로 활성 워크스페이스를 찾지 못함 */
  WORKSPACE_NOT_FOUND: 'workspace_not_found',
  /** 워크스페이스는 있으나 그 주소에 게시된 서비스가 없음 */
  SERVICE_NOT_FOUND: 'service_not_found',
  /** 운영자가 이 서비스의 트래픽을 끊어 둠 */
  SERVICE_BLOCKED: 'service_blocked',
  /** 서비스는 있으나 연결된 배포 에이전트가 없음(미연결/삭제됨) */
  AGENT_NOT_FOUND: 'agent_not_found',
  /** 에이전트 WS 제어 채널이 끊겨 연결 명령을 보낼 수조차 없음 */
  AGENT_OFFLINE: 'agent_offline',
  /** Hub 내부 오류 (DB 조회 실패 등) */
  DB_ERROR: 'db_error',

  // --- 게이트웨이가 판정하는 원인 ---
  /** 요청에 Host 헤더가 없음 */
  MISSING_HOST: 'missing_host',
  /** Host가 OPTiCS 서비스 주소 형식이 아님 */
  INVALID_ROUTE: 'invalid_route',
  /** Hub API에 도달하지 못함(프로세스 다운, 커넥션 거부 등) */
  HUB_UNREACHABLE: 'hub_unreachable',
  /** Hub가 예상하지 못한 상태로 거절함(내부 시크릿 불일치 등) */
  HUB_REJECTED: 'hub_rejected',
  /** 연결 명령은 나갔으나 에이전트가 제한 시간 내에 터널을 열지 않음 */
  AGENT_NO_TUNNEL: 'agent_no_tunnel',
} as const;

export type TunnelOutcome = typeof TUNNEL_OUTCOME[keyof typeof TUNNEL_OUTCOME];

const KNOWN_OUTCOMES = new Set<string>(Object.values(TUNNEL_OUTCOME));

export function isTunnelOutcome(value: unknown): value is TunnelOutcome {
  return typeof value === 'string' && KNOWN_OUTCOMES.has(value);
}
