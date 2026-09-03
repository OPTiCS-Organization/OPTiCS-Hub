/*
 * 게이트웨이 오류 응답 블랙박스 테스트입니다.
 *
 * 이 코드는 raw TCP 위에서 HTTP를 직접 다루므로 내부 함수를 꺼내 검증하기보다
 * 실제 소켓에 요청 바이트를 밀어넣고 돌아온 바이트를 읽는 방식으로 확인합니다.
 * Hub는 스텁 HTTP 서버로 대신 세워, outcome이 실린 실패 응답을 마음대로 만듭니다.
 */
import net, { type AddressInfo } from 'net';
import http from 'http';
import { startProxyServer } from '../proxy/server';
import { TUNNEL_OUTCOME } from '../src/tunnel/tunnel-outcome';

type HubReply = { status: number; body?: unknown };

/** 각 테스트가 스텁 Hub의 응답을 여기에 지정한다. */
let hubReply: HubReply = { status: 200, body: { outcome: TUNNEL_OUTCOME.SUCCESS } };
/** Hub가 받은 요청 헤더를 확인하기 위해 마지막 요청을 보관한다. */
let lastHubRequest: http.IncomingMessage | null = null;

let proxyServer: net.Server;
let hubServer: http.Server;
let proxyPort: number;

function listening(server: net.Server | http.Server) {
  return new Promise<void>((resolve) => server.once('listening', () => resolve()));
}

function closed(server: net.Server | http.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 응답이 끝날 때까지(connection: close) 읽어서 통째로 돌려준다. */
function sendRaw(raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, '127.0.0.1');
    let received = '';
    socket.setTimeout(20_000, () => {
      socket.destroy();
      reject(new Error('gateway did not respond in time'));
    });
    socket.on('connect', () => socket.write(raw));
    socket.on('data', (chunk) => { received += chunk.toString(); });
    socket.on('close', () => resolve(received));
    socket.on('error', reject);
  });
}

function get(host: string) {
  return sendRaw(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
}

function parse(response: string) {
  const separator = response.indexOf('\r\n\r\n');
  const [statusLine, ...headerLines] = response.slice(0, separator).split('\r\n');
  const headers = new Map(headerLines.map((line) => {
    const at = line.indexOf(':');
    return [line.slice(0, at).toLowerCase().trim(), line.slice(at + 1).trim()] as const;
  }));
  return { statusLine, headers, body: response.slice(separator + 4) };
}

beforeAll(async () => {
  hubServer = http.createServer((request, response) => {
    lastHubRequest = request;
    request.resume();
    response.writeHead(hubReply.status, { 'content-type': 'application/json' });
    response.end(hubReply.body === undefined ? '' : JSON.stringify(hubReply.body));
  });
  hubServer.listen(0, '127.0.0.1');
  await listening(hubServer);
  process.env.HUB_API_URL = `http://127.0.0.1:${(hubServer.address() as AddressInfo).port}`;

  proxyServer = startProxyServer(0);
  await listening(proxyServer);
  proxyPort = (proxyServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await closed(proxyServer);
  await closed(hubServer);
});

beforeEach(() => {
  hubReply = { status: 200, body: { outcome: TUNNEL_OUTCOME.SUCCESS } };
  lastHubRequest = null;
});

// 클라이언트 소켓이 닫힌 직후 서버 쪽 close 핸들러가 한 박자 늦게 돈다.
// 그 사이에 테스트가 끝나면 jest가 "Cannot log after tests are done"을 띄운다.
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

describe('오류 응답의 형태', () => {
  it('빈 본문이 아니라 실제 HTML 페이지를 내려준다', async () => {
    const { statusLine, headers, body } = parse(await get('nope.example.com'));

    expect(statusLine).toBe('HTTP/1.1 404 Requested Service Not Found');
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(body).toContain('<!doctype html>');
    // 본문 없이 나가면 브라우저가 자기 기본 오류 화면을 그린다.
    expect(body.length).toBeGreaterThan(0);
  });

  it('content-length가 본문의 실제 바이트 수와 일치한다', async () => {
    const { headers, body } = parse(await get('nope.example.com'));

    expect(Number(headers.get('content-length'))).toBe(Buffer.byteLength(body));
  });

  it('진단용으로 outcome과 request id를 페이지에 노출한다', async () => {
    const { body } = parse(await get('nope.example.com'));

    expect(body).toContain(TUNNEL_OUTCOME.INVALID_ROUTE);
    expect(body).toMatch(/opt_[0-9A-HJKMNP-TV-Z]{26}/);
  });
});

describe('Host 헤더 처리', () => {
  it('Host가 없으면 missing_host로 답한다', async () => {
    const { statusLine, body } = parse(await sendRaw('GET / HTTP/1.0\r\n\r\n'));

    expect(statusLine).toContain('404');
    expect(body).toContain(TUNNEL_OUTCOME.MISSING_HOST);
  });

  it('OPTiCS 주소가 아니면 invalid_route로 답한다', async () => {
    const { statusLine, body } = parse(await get('example.com'));

    expect(statusLine).toContain('404');
    expect(body).toContain(TUNNEL_OUTCOME.INVALID_ROUTE);
  });

  it('Host를 페이지에 넣을 때 HTML을 이스케이프한다', async () => {
    const { body } = parse(await get('<script>alert(1)</script>.evil.com'));

    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).not.toContain('<script>alert(1)</script>');
  });

  it('워크스페이스 루트 주소도 라우팅 대상으로 받아들인다', async () => {
    hubReply = { status: 404, body: { outcome: TUNNEL_OUTCOME.SERVICE_NOT_FOUND } };

    const { body } = parse(await get('demo.optics.run'));

    // invalid_route로 튕기지 않고 Hub까지 갔다는 뜻이다.
    expect(lastHubRequest).not.toBeNull();
    expect(body).toContain(TUNNEL_OUTCOME.SERVICE_NOT_FOUND);
  });
});

describe('Hub가 알려준 outcome을 그대로 반영한다', () => {
  it('요청에 x-request-id를 실어 Hub로 넘긴다', async () => {
    hubReply = { status: 404, body: { outcome: TUNNEL_OUTCOME.WORKSPACE_NOT_FOUND } };

    const { body } = parse(await get('api.demo.optics.run'));

    const requestId = lastHubRequest?.headers['x-request-id'];
    expect(requestId).toMatch(/^opt_/);
    expect(body).toContain(String(requestId));
  });

  it.each([
    [TUNNEL_OUTCOME.WORKSPACE_NOT_FOUND, 404, 'HTTP/1.1 404 Requested Service Not Found'],
    [TUNNEL_OUTCOME.SERVICE_NOT_FOUND, 404, 'HTTP/1.1 404 Requested Service Not Found'],
    [TUNNEL_OUTCOME.AGENT_NOT_FOUND, 404, 'HTTP/1.1 503 Service Unavailable'],
    [TUNNEL_OUTCOME.AGENT_OFFLINE, 503, 'HTTP/1.1 503 Service Unavailable'],
    [TUNNEL_OUTCOME.DB_ERROR, 500, 'HTTP/1.1 503 Service Unavailable'],
  ])('%s는 %d로 와도 outcome을 보고 페이지를 고른다', async (outcome, hubStatus, expectedStatusLine) => {
    hubReply = { status: hubStatus, body: { outcome } };

    const { statusLine, body } = parse(await get('api.demo.optics.run'));

    expect(statusLine).toBe(expectedStatusLine);
    expect(body).toContain(outcome);
  });

  it('상태 코드가 같아도 원인이 다르면 다른 문구를 보여준다', async () => {
    hubReply = { status: 404, body: { outcome: TUNNEL_OUTCOME.WORKSPACE_NOT_FOUND } };
    const workspaceMissing = parse(await get('api.demo.optics.run')).body;

    hubReply = { status: 404, body: { outcome: TUNNEL_OUTCOME.SERVICE_NOT_FOUND } };
    const serviceMissing = parse(await get('api.demo.optics.run')).body;

    expect(workspaceMissing).toContain('No active workspace is registered');
    expect(serviceMissing).toContain('no service published');
  });
});

describe('Hub 응답을 믿을 수 없을 때의 폴백', () => {
  it('본문에 outcome이 없으면 404는 service_not_found로 본다', async () => {
    hubReply = { status: 404, body: { message: 'Service not found' } };

    const { statusLine, body } = parse(await get('api.demo.optics.run'));

    expect(statusLine).toContain('404');
    expect(body).toContain(TUNNEL_OUTCOME.SERVICE_NOT_FOUND);
  });

  it('본문에 outcome이 없는 그 밖의 실패는 hub_rejected로 본다', async () => {
    hubReply = { status: 401, body: { message: 'Unauthorized' } };

    const { statusLine, body } = parse(await get('api.demo.optics.run'));

    expect(statusLine).toBe('HTTP/1.1 503 Service Unavailable');
    expect(body).toContain(TUNNEL_OUTCOME.HUB_REJECTED);
  });

  it('본문이 JSON이 아니어도 페이지를 그린다', async () => {
    hubReply = { status: 502, body: undefined };

    const { statusLine, body } = parse(await get('api.demo.optics.run'));

    expect(statusLine).toBe('HTTP/1.1 503 Service Unavailable');
    expect(body).toContain(TUNNEL_OUTCOME.HUB_REJECTED);
  });

  it('어휘에 없는 outcome은 신뢰하지 않고 상태 코드로 판단한다', async () => {
    hubReply = { status: 500, body: { outcome: 'something_we_never_defined' } };

    const { body } = parse(await get('api.demo.optics.run'));

    expect(body).toContain(TUNNEL_OUTCOME.HUB_REJECTED);
    expect(body).not.toContain('something_we_never_defined');
  });

  it('Hub에 아예 닿지 못하면 hub_unreachable로 답한다', async () => {
    const reachable = process.env.HUB_API_URL;
    // 아무도 듣고 있지 않은 포트로 돌려 커넥션 거부를 만든다.
    process.env.HUB_API_URL = 'http://127.0.0.1:1';

    try {
      const { statusLine, body } = parse(await get('api.demo.optics.run'));

      expect(statusLine).toBe('HTTP/1.1 503 Service Unavailable');
      expect(body).toContain(TUNNEL_OUTCOME.HUB_UNREACHABLE);
      expect(body).toContain('could not reach the OPTiCS control plane');
    } finally {
      process.env.HUB_API_URL = reachable;
    }
  });
});

describe('에이전트가 터널을 열지 않을 때', () => {
  // registry의 대기 시간이 10초로 고정되어 있어 이 테스트만 느리다.
  it('연결 명령은 성공했지만 터널이 오지 않으면 agent_no_tunnel로 답한다', async () => {
    hubReply = { status: 200, body: { outcome: TUNNEL_OUTCOME.SUCCESS } };

    const { statusLine, body } = parse(await get('api.demo.optics.run'));

    expect(statusLine).toBe('HTTP/1.1 503 Service Unavailable');
    expect(body).toContain(TUNNEL_OUTCOME.AGENT_NO_TUNNEL);
    expect(body).toContain('did not do so in time');
  }, 20_000);
});
