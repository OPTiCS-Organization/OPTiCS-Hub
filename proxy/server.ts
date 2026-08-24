/*
 * 외부 요청을 처음 받는 공개 프록시 서버입니다. (:10000)
 *
 * nginx에서 넘어온 HTTP 클라이언트 소켓을 받아 Host 헤더에서 라우팅 정보를
 * 추출하고, 해당 소켓을 일회용 토큰으로 레지스트리에 등록합니다. 이후 Hub API에
 * 이 토큰으로 연결할 Agent를 찾아 reverse tunnel을 열도록 요청한다..
 *
 * 터널 서버 쪽에서 같은 토큰을 가진 Agent 소켓이 도착하면, 공개 클라이언트 소켓과
 * Agent 터널 소켓을 그대로 연결해서 TCP 바이트를 양방향으로 흘려보낸다.
 */
import net from 'net';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { register, release } from '../tunnel/registry.ts';
import { TUNNEL_OUTCOME, isTunnelOutcome, type TunnelOutcome } from '../src/tunnel/tunnel-outcome.ts';
import { presentationFor, type ErrorTemplateName } from './outcome-presentation.ts';
import dotenv from 'dotenv';
import { ulid } from 'ulid';
dotenv.config({ path: '../OPTiCS-Infra/env/gateway.env' })

// 프로세스는 항상 OPTiCS-Hub 루트(WORKDIR)에서 기동되므로 cwd 기준 상대 경로로 읽는다.
function readTemplate(name: ErrorTemplateName) {
  return fs.readFileSync(path.join(process.cwd(), 'proxy', 'templates', `${name}.html`), 'utf-8');
}

const TEMPLATES: Record<ErrorTemplateName, string> = {
  RequestedServiceNotFound: readTemplate('RequestedServiceNotFound'),
  BadGateway: readTemplate('BadGateway'),
};

// Host 헤더 등 외부 입력이 그대로 들어오므로 치환 값은 반드시 이스케이프한다.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * vars는 이스케이프해서, rawVars는 그대로 삽입한다.
 * rawVars에는 우리가 코드에서 만든 HTML 조각만 넣어야 하며, 그 안에 들어가는
 * 외부 입력은 조각을 만들 때 이미 이스케이프되어 있어야 한다.
 */
function renderTemplate(
  template: string,
  vars: Record<string, string>,
  rawVars: Record<string, string> = {},
) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(rawVars, key)) return rawVars[key];
    return Object.prototype.hasOwnProperty.call(vars, key) ? escapeHtml(vars[key]) : match;
  });
}

// Cloudflare가 프록시한 요청에는 cf-ray 헤더가 붙는다. CF를 거치지 않은
// 직접 접근에는 없으므로 그때는 '-'로 표시한다.
function readCfRay(header: string[]) {
  const line = header.find(value => value.toLowerCase().startsWith('cf-ray:'));
  return line === undefined ? '-' : line.replace(/^cf-ray:\s*/i, '').trim() || '-';
}

type ErrorContext = {
  host: string;
  /** 다이어그램 마지막 노드 이름. 워크스페이스 루트 요청은 서비스 서브도메인이 비어 있다. */
  serviceName?: string;
  requestId: string;
  rayId: string;
};

/**
 * 실패 원인(outcome) 하나로 상태 코드·템플릿·문구를 모두 결정해 완성된 HTTP 응답을 만든다.
 */
function renderErrorResponse(outcome: Exclude<TunnelOutcome, 'success'>, context: ErrorContext) {
  const presentation = presentationFor(outcome);
  const host = context.host || 'unknown host';
  const body = renderTemplate(
    TEMPLATES[presentation.template],
    {
      requestUrl: host,
      serviceName: context.serviceName || host,
      requestId: context.requestId,
      rayId: context.rayId,
      outcome,
      timestamp: new Date().toISOString(),
    },
    { detail: presentation.detail(escapeHtml(host)) },
  );
  return makeHtmlResponse(presentation.status, presentation.reason, body);
}

const proxyServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  const token = randomUUID();
  const requestId = `opt_${ulid()}`;
  let startedAt: number | null = null;
  let tunnelConnected = false;
  let ttfbRecorded = false;

  const onData = async (chunk: NonSharedBuffer) => {
    if (startedAt === null) startedAt = performance.now();
    const requestStartedAt = startedAt;
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) return;

    // host: workspace.optics.run or service.workspace.optics.run
    const header = buffer.subarray(0, idx).toString().split('\r\n');
    const [requestLine = ''] = header;
    const method = requestLine.split(' ')[0] || 'UNKNOWN';
    const rayId = readCfRay(header);
    const hostLine = header.find(line => line.toLowerCase().startsWith('host:'));
    if (hostLine === undefined) {
      logDiagnostic('proxy_request_rejected', requestId, {
        outcome: TUNNEL_OUTCOME.MISSING_HOST,
        elapsed_ms: elapsedSince(requestStartedAt),
      });
      socket.end(renderErrorResponse(TUNNEL_OUTCOME.MISSING_HOST, { host: '', requestId, rayId }));
      return;
    }
    const route = parseRouteFromHostHeader(hostLine);
    if (route === null) {
      const rejectedHost = hostLine.replace(/^host:\s*/i, '').trim();
      logDiagnostic('proxy_request_rejected', requestId, {
        method,
        host: rejectedHost,
        outcome: TUNNEL_OUTCOME.INVALID_ROUTE,
        elapsed_ms: elapsedSince(requestStartedAt),
      });
      socket.end(renderErrorResponse(TUNNEL_OUTCOME.INVALID_ROUTE, { host: rejectedHost, requestId, rayId }));
      return;
    }

    const { serviceSubdomain, workspaceSubdomain } = route;
    const host = hostLine.replace(/^host:\s*/i, '').trim();
    buffer = withRequestIdHeader(buffer, idx, requestId);

    register(token, socket, buffer, () => {
      logDiagnostic('agent_not_responding', requestId, {
        method,
        host,
        outcome: TUNNEL_OUTCOME.AGENT_NO_TUNNEL,
        elapsed_ms: elapsedSince(requestStartedAt),
      });
      socket.end(renderErrorResponse(TUNNEL_OUTCOME.AGENT_NO_TUNNEL, {
        host,
        serviceName: serviceSubdomain,
        requestId,
        rayId,
      }));
    }, {
      requestId,
      startedAt: requestStartedAt,
      method,
      host,
      rayId,
      onTunnelSetup: () => {
        tunnelConnected = true;
        logDiagnostic('proxy_tunnel_connected', requestId, {
          method,
          host,
          tunnel_setup_ms: elapsedSince(requestStartedAt),
        });
      },
      onTtfb: () => {
        if (ttfbRecorded) return;
        ttfbRecorded = true;
        logDiagnostic('proxy_response_started', requestId, {
          method,
          host,
          ttfb_ms: elapsedSince(requestStartedAt),
        });
      },
    });
    logDiagnostic('proxy_request_registered', requestId, {
      method,
      host,
    });
    socket.off('data', onData);
    socket.pause();

    const body = {
      serviceSubdomain,
      workspaceSubdomain,
      token,
    };

    try {
      const response = await fetch(`${process.env.HUB_API_URL}/v1/tunnel/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.TUNNEL_INTERNAL_SECRET ?? '',
          "x-request-id": requestId,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const outcome = await readHubOutcome(response);
        logDiagnostic('proxy_hub_request_failed', requestId, {
          method,
          host,
          hub_status: response.status,
          outcome,
          elapsed_ms: elapsedSince(requestStartedAt),
        });
        socket.end(renderErrorResponse(outcome, {
          host,
          serviceName: serviceSubdomain,
          requestId,
          rayId,
        }));
        return;
      }

      const hubDiagnostics = await response.json().catch(() => null) as {
        hub_db_query_ms?: unknown;
      } | null;
      logDiagnostic('proxy_hub_routing_completed', requestId, {
        method,
        host,
        hub_db_query_ms: typeof hubDiagnostics?.hub_db_query_ms === 'number'
          ? hubDiagnostics.hub_db_query_ms
          : undefined,
        elapsed_ms: elapsedSince(requestStartedAt),
      });
    } catch (error) {
      socket.end(renderErrorResponse(TUNNEL_OUTCOME.HUB_UNREACHABLE, {
        host,
        serviceName: serviceSubdomain,
        requestId,
        rayId,
      }));
      logDiagnostic('proxy_hub_request_error', requestId, {
        method,
        host,
        outcome: TUNNEL_OUTCOME.HUB_UNREACHABLE,
        error: error instanceof Error ? error.message : String(error),
        elapsed_ms: elapsedSince(requestStartedAt),
      });
    }
  }

  const onClose = () => {
    release(token, socket);
    if (startedAt !== null) {
      logDiagnostic('proxy_connection_closed', requestId, {
        outcome: tunnelConnected ? 'connected' : 'closed_before_tunnel',
        connection_duration_ms: elapsedSince(startedAt),
      });
    }
  }

  const onError = (error: Error) => {
    console.error(error);
  }

  socket.once('close', onClose);
  socket.once('error', onError);
  socket.on('data', onData);
});

export function startProxyServer(port: number) {
  proxyServer.listen(port, () => console.log(`Proxy server is running on ${port}`))
}

/**
 * Hub는 실패 원인을 응답 본문의 outcome으로 알려 준다. 본문을 못 읽거나 값이
 * 어휘에 없으면(구버전 Hub, 게이트웨이 외부에서 온 오류 등) 상태 코드로 최선의
 * 추정을 한다.
 */
async function readHubOutcome(response: Response): Promise<Exclude<TunnelOutcome, 'success'>> {
  const body = await response.json().catch(() => null) as { outcome?: unknown } | null;
  const outcome = body?.outcome;
  if (isTunnelOutcome(outcome) && outcome !== TUNNEL_OUTCOME.SUCCESS) return outcome;
  return response.status === 404 ? TUNNEL_OUTCOME.SERVICE_NOT_FOUND : TUNNEL_OUTCOME.HUB_REJECTED;
}

function makeHtmlResponse(status: number, reason: string, body: string) {
  return `HTTP/1.1 ${status} ${reason}\r\n` +
    `content-type: text/html; charset=utf-8\r\n` +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    `connection: close\r\n` +
    `\r\n` +
    body;
}

function withRequestIdHeader(buffer: Buffer, headerEnd: number, requestId: string) {
  const lines = buffer.subarray(0, headerEnd).toString().split('\r\n');
  const requestLine = lines.shift() ?? '';
  const headers = lines.filter(line => !line.toLowerCase().startsWith('x-request-id:'));
  const rewrittenHeader = [requestLine, ...headers, `x-request-id: ${requestId}`, '', ''].join('\r\n');
  return Buffer.concat([Buffer.from(rewrittenHeader), buffer.subarray(headerEnd + 4)]);
}

function elapsedSince(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function logDiagnostic(event: string, requestId: string, fields: Record<string, unknown>) {
  const sanitizedFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    component: 'gateway',
    event,
    request_id: requestId,
    ...sanitizedFields,
  }));
}

function parseRouteFromHostHeader(hostLine: string): { serviceSubdomain: string; workspaceSubdomain: string } | null {
  const host = hostLine
    .replace(/^host:\s*/i, '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .split(':')[0];

  const labels = host.split('.');
  if (labels.length !== 3 && labels.length !== 4) return null;

  if (labels.length === 3) {
    if (labels[1] !== 'optics' || labels[2] !== 'run') return null;

    const [workspaceSubdomain] = labels;
    if (!isValidSubdomainLabel(workspaceSubdomain)) return null;

    return { serviceSubdomain: '', workspaceSubdomain };
  }

  if (labels[2] !== 'optics' || labels[3] !== 'run') return null;

  const [serviceSubdomain, workspaceSubdomain] = labels;
  if (!isValidSubdomainLabel(serviceSubdomain) || !isValidSubdomainLabel(workspaceSubdomain)) return null;

  return { serviceSubdomain, workspaceSubdomain };
}

function isValidSubdomainLabel(value: string) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}
