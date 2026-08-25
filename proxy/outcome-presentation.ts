/*
 * outcome 하나를 오류 페이지 한 장으로 옮기는 표입니다.
 *
 * 게이트웨이는 상태 코드로 분기하지 않고 여기서만 분기합니다. 케이스가 늘어도
 * 이 표에 줄 하나를 더하면 되고, 분기 축은 outcome 하나로 유지됩니다.
 */
import { TUNNEL_OUTCOME, type TunnelOutcome } from '../src/tunnel/tunnel-outcome.ts';

export type ErrorTemplateName = 'RequestedServiceNotFound' | 'BadGateway';

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

// 502로 통일한다. 504는 Cloudflare의 게이트웨이 오류 페이지에 가로채여서 커스텀 페이지가 사용자에게 표시되지 않는다.
const BAD_GATEWAY = (detail: OutcomePresentation['detail']): OutcomePresentation => ({
  status: 502,
  reason: 'Bad Gateway',
  template: 'BadGateway',
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

  [TUNNEL_OUTCOME.AGENT_NOT_FOUND]: BAD_GATEWAY(
    (host) => `The service at <code>${host}</code> is not linked to a deployment agent, so the OPTiCS Gateway had nowhere to forward your request.`,
  ),

  [TUNNEL_OUTCOME.AGENT_OFFLINE]: BAD_GATEWAY(
    (host) => `The deployment agent hosting <code>${host}</code> is not connected to OPTiCS, so your request could not be forwarded to it. Its host machine is likely offline.`,
  ),

  [TUNNEL_OUTCOME.AGENT_NO_TUNNEL]: BAD_GATEWAY(
    (host) => `OPTiCS asked the deployment agent hosting <code>${host}</code> to open a tunnel, but it did not do so in time. The agent may be unresponsive, or the service it fronts may have failed to start.`,
  ),

  [TUNNEL_OUTCOME.HUB_UNREACHABLE]: BAD_GATEWAY(
    () => 'The OPTiCS Gateway could not reach the OPTiCS control plane, so it could not look up where to send your request. This is a problem on our side, not with the service you requested.',
  ),

  [TUNNEL_OUTCOME.HUB_REJECTED]: BAD_GATEWAY(
    () => 'The OPTiCS control plane rejected the routing request. This is a problem on our side, not with the service you requested.',
  ),

  [TUNNEL_OUTCOME.DB_ERROR]: BAD_GATEWAY(
    (host) => `The OPTiCS control plane failed while looking up <code>${host}</code>. This is a problem on our side, not with the service you requested.`,
  ),
};

export function presentationFor(outcome: Exclude<TunnelOutcome, 'success'>): OutcomePresentation {
  return PRESENTATIONS[outcome];
}
