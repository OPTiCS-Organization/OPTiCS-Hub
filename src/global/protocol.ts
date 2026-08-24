/**
 * Hub가 이해하는 소켓 계약 버전의 범위.
 *
 * 계약 정의: OPTiCS-Hub/docs/protocol_v1.md
 *
 * Agent는 자신이 구현한 버전 하나(점)를 선언하고, Hub는 받아줄 수 있는 범위(구간)를 선언한다.
 * 같은 값을 양쪽에 복제하는 것이 아니라 서로 다른 사실을 말하는 것이므로 동기화 대상이 아니다.
 *
 * min을 올리는 것은 곧 그 아래 Agent의 연결을 끊는다는 뜻이다.
 * 유예 기간을 공지한 뒤에만 올린다.
 */
export const SUPPORTED_PROTOCOL = {
  /** 이 값 미만은 지원하지 않는다. 0 = 프로토콜 협상이 없던 시절의 Agent. */
  min: 0,
  /** Hub가 아는 최신 계약. 이보다 높은 Agent는 Hub가 구버전이라는 뜻이다. */
  current: 1,
} as const;

export function isProtocolSupported(protocol: number): boolean {
  return protocol >= SUPPORTED_PROTOCOL.min && protocol <= SUPPORTED_PROTOCOL.current;
}
