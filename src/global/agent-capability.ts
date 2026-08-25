import { compareSemver } from './semver.util';

/**
 * 원격 업데이트(update-agent 이벤트 처리)가 들어간 최초 Agent 버전.
 *
 * 이보다 낮은 Agent에는 리스너 자체가 없다. socket.io는 모르는 이벤트를 버리므로
 * 명령을 보내도 실패조차 하지 않고 아무 일도 일어나지 않는다.
 * 그래서 보내기 전에 막아야 하고, 사용자에게는 수동 업데이트를 안내해야 한다.
 */
export const MIN_REMOTE_UPDATE_VERSION = '0.6.0';

/** 버전을 보고하지 않는 Agent(0.5.0 미만)도 당연히 지원하지 않는다. */
export function supportsRemoteUpdate(agentVersion: string | null): boolean {
  if (!agentVersion) return false;
  return compareSemver(agentVersion, MIN_REMOTE_UPDATE_VERSION) >= 0;
}
