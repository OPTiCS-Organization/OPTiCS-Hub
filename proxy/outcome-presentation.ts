/*
 * outcome 하나를 오류 페이지 한 장으로 옮기는 표입니다.
 *
 * 게이트웨이는 상태 코드로 분기하지 않고 여기서만 분기합니다. 케이스가 늘어도
 * 이 표에 줄 하나를 더하면 되고, 분기 축은 outcome 하나로 유지됩니다.
 */
import { TUNNEL_OUTCOME, type TunnelOutcome } from '../src/tunnel/tunnel-outcome.ts';

export type ErrorTemplateName = 'RequestedServiceNotFound' | 'ServiceUnavailable';

export type OutcomePresentation = {
  status: number;
  reason: string;
  template: ErrorTemplateName;
  /**
   * "What happened?" 문단에 들어가는 HTML 조각을 만든다.
   * 반환값은 이스케이프 없이 삽입되므로, 외부 입력은 반드시 인자로 받은
   * escape된 값만 사용해야 한다.
   */
  detail: (escapedHost: string) => string;
};

const NOT_FOUND = (
  reason: string,
  detail: OutcomePresentation['detail'],
): OutcomePresentation => ({
  status: 404,
  reason,
  template: 'RequestedServiceNotFound',
  detail,
});

/*
 * 503으로 통일한다. 이유가 두 가지인데 둘 다 502를 쓸 수 없게 만든다.
 *
 * 첫째, Cloudflare는 오리진이 보낸 502와 504의 본문을 자기 오류 페이지로 갈아치운다.
 * origin_error_page_pass_thru를 켜면 통과하지만 그건 Enterprise 전용이다. 전에 504를
 * 버리고 502로 옮긴 적이 있는데, 가로채는 기준은 코드가 아니라 저 설정이라 502도
 * 똑같이 먹혔다. 그동안 이 표의 문구는 사용자에게 한 번도 도달하지 못했다.
 * 500과 503은 가로채지 않으므로 여기를 벗어나려면 그 둘 중 하나여야 한다.
 *
 * 둘째, 애초에 503이 맞는 코드다. 아래 원인들은 전부 '지금 일시적으로 못 준다'이지
 * '상류에서 잘못된 응답을 받았다'가 아니다. 502로 쓰던 게 부정확했던 것이다.
 */
const SERVICE_UNAVAILABLE = (detail: OutcomePresentation['detail']): OutcomePresentation => ({
  status: 503,
  reason: 'Service Unavailable',
  template: 'ServiceUnavailable',
  detail,
});

const PRESENTATIONS: Record<Exclude<TunnelOutcome, 'success'>, OutcomePresentation> = {
  [TUNNEL_OUTCOME.MISSING_HOST]: NOT_FOUND(
    'Requested Service Not Found',
    () => 'Your request did not include a <code>Host</code> header, so the OPTiCS Gateway could not tell which service it was meant for.',
  ),

  [TUNNEL_OUTCOME.INVALID_ROUTE]: NOT_FOUND(
    'Requested Service Not Found',
    (host) => `<code>${host}</code> is not an OPTiCS service address. Service addresses look like <code>service.workspace.optics.run</code>.`,
  ),

  [TUNNEL_OUTCOME.WORKSPACE_NOT_FOUND]: NOT_FOUND(
    'Requested Service Not Found',
    (host) => `No active workspace is registered at <code>${host}</code>. The workspace may have been renamed, deactivated, or deleted.`,
  ),

  [TUNNEL_OUTCOME.SERVICE_NOT_FOUND]: NOT_FOUND(
    'Requested Service Not Found',
    (host) => `The workspace exists, but it has no service published at <code>${host}</code>. The address may be misspelled, or the service may have been removed.`,
  ),

  [TUNNEL_OUTCOME.AGENT_NOT_FOUND]: SERVICE_UNAVAILABLE(
    (host) => `The service at <code>${host}</code> is not linked to a deployment agent, so the OPTiCS Gateway had nowhere to forward your request.`,
  ),

  [TUNNEL_OUTCOME.AGENT_OFFLINE]: SERVICE_UNAVAILABLE(
    (host) => `The deployment agent hosting <code>${host}</code> is not connected to OPTiCS, so your request could not be forwarded to it. Its host machine is likely offline.`,
  ),

  [TUNNEL_OUTCOME.AGENT_NO_TUNNEL]: SERVICE_UNAVAILABLE(
    (host) => `OPTiCS asked the deployment agent hosting <code>${host}</code> to open a tunnel, but it did not do so in time. The agent may be unresponsive, or the service it fronts may have failed to start.`,
  ),

  [TUNNEL_OUTCOME.HUB_UNREACHABLE]: SERVICE_UNAVAILABLE(
    () => 'The OPTiCS Gateway could not reach the OPTiCS control plane, so it could not look up where to send your request. This is a problem on our side, not with the service you requested.',
  ),

  [TUNNEL_OUTCOME.HUB_REJECTED]: SERVICE_UNAVAILABLE(
    () => 'The OPTiCS control plane rejected the routing request. This is a problem on our side, not with the service you requested.',
  ),

  [TUNNEL_OUTCOME.DB_ERROR]: SERVICE_UNAVAILABLE(
    (host) => `The OPTiCS control plane failed while looking up <code>${host}</code>. This is a problem on our side, not with the service you requested.`,
  ),
};

export function presentationFor(outcome: Exclude<TunnelOutcome, 'success'>): OutcomePresentation {
  return PRESENTATIONS[outcome];
}
