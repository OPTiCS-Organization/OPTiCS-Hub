/*
 * 외부 요청을 처음 받는 공개 프록시 서버입니다.
 *
 * nginx에서 넘어온 HTTP 클라이언트 소켓을 받아 Host 헤더에서 라우팅 정보를
 * 추출하고, 해당 소켓을 일회용 토큰으로 레지스트리에 등록합니다. 이후 Hub API에
 * 이 토큰으로 연결할 Agent를 찾아 reverse tunnel을 열도록 요청한다..
 *
 * 터널 서버 쪽에서 같은 토큰을 가진 Agent 소켓이 도착하면, 공개 클라이언트 소켓과
 * Agent 터널 소켓을 그대로 연결해서 TCP 바이트를 양방향으로 흘려보낸다.
 */
import net from 'net';
import { randomUUID } from 'crypto';
import { register, release } from '../tunnel/registry.ts';
import dotenv from 'dotenv';
dotenv.config({ path: '../OPTiCS-Infra/env/gateway.env' })

const proxyServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  const token = randomUUID();

  const onData = async (chunk: NonSharedBuffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) return;

    // host: workspace.optics.run or service.workspace.optics.run
    const header = buffer.subarray(0, idx).toString().split('\r\n');
    const hostLine = header.find(line => line.toLowerCase().startsWith('host:'));
    if (hostLine === undefined) {
      socket.end(makeResponse(404, 'Requested Service Not Found'));
      return;
    }
    const route = parseRouteFromHostHeader(hostLine);
    if (route === null) {
      socket.end(makeResponse(404, 'Requested Service Not Found'));
      return;
    }

    const { serviceSubdomain, workspaceSubdomain } = route;

    register(token, socket, buffer, () => {
      socket.end(makeResponse(504, 'Gateway Timeout'));
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
          "x-internal-secret": process.env.TUNNEL_INTERNAL_SECRET,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const status = response.status === 404 ? 404 : 504;
        const reason = response.status === 404 ? 'Requested Service Not Found' : 'Gateway Timeout';
        socket.end(makeResponse(status, reason));
      }
    } catch (error) {
      socket.end(makeResponse(504, 'Gateway Timeout'));
      console.log(error);
    }
  }

  const onClose = () => {
    release(token, socket)
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

function makeResponse(status: number, reason: string, body: string = '') {
  return `HTTP/1.1 ${status} ${reason}\r\n` +
    `content-type: text/plain\r\n` +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    `connection: close\r\n` +
    `\r\n` +
    body;
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
