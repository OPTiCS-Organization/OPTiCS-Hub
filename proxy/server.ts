import net from 'net';
import { randomUUID } from 'crypto';
import { register, release } from '../tunnel/registry.ts';
import dotenv from 'dotenv';
dotenv.config({ path: '../OPTiCS-Infra/env/gateway.env' })

/**
 * 클라이언트의 연결을 받는 프록시 서버
 * 역할
 * - 클라이언트의 HTTP 요청에서 서브도메인을 파싱 후 터널 서버에 전달
 * - 터널 서버에서 에이전트 연결을 대기하다가 연결되면 클라이언트와 에이전트 서비스 간 TCP 바이트 파이핑을 통해 통신
 */
const proxyServer = net.createServer((socket) => {
  /**
   * 연결 수립 시 HTTP 요청을 받을 버퍼 생성
   * 터널 토큰 생성
   */
  let buffer = Buffer.alloc(0);
  const token = randomUUID();

  const onData = async (chunk: NonSharedBuffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) return;  // HTTP 헤더 분리 실패 시 처리하지 않음

    const header = buffer.subarray(0, idx).toString().split('\r\n')
    const hostLine = header.find(line => line.toLowerCase().startsWith('host:'));
    const serviceName = hostLine?.toLowerCase().replace('host: ', '').split(':')[0].split('.')[0];

    console.log(
      `[ProxyServer] HTTP_REQUEST_RECEIVED\n` +
      `  Service : ${serviceName}\n` +
      `  Token : ${token}`
    );

    register(token, socket, buffer, () => {  // 터널 토큰 등록
      socket.end(makeResponse(504, 'Gateway Timeout'));
    });
    socket.off('data', onData);
    socket.pause();

    const body = {
      subdomain: serviceName,
      token: token
    }

    try {
      const response = await fetch(`${process.env.HUB_API_URL}/v1/tunnel/connect`, {
        method: "POST",
        headers: new Headers({
          "Content-Type": "application/json",
          "x-internal-secret": process.env.TUNNEL_INTERNAL_SECRET ?? '',
        }),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        socket.end(makeResponse(504, 'Gateway Timeout'));
      }
    } catch (error) {
      console.log(
        `[ProxyServer] TUNNEL_CONNECTION_ERROR\n` +
        `  Error : ${error}\n` +
        `  Token : ${token}\n` +
        `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
      );
      socket.end(makeResponse(504, 'Gateway Timeout'));
    }
  }

  const onClose = () => {
    console.log(
      `[ProxyServer] HTTP_REQUEST_CLOSED\n` +
      `  Side : Client\n` +
      `  Token : ${token}\n` +
      `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
    );
    release(token, socket, 'proxy_close')
  }

  const onError = (error: Error) => {
    console.error(
      `[ProxyServer] PROXY_SERVER_ERROR\n` +
      `  Error : ${error}\n` +
      `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
    );
  }

  socket.once('close', onClose);
  socket.once('error', onError);
  socket.on('data', onData);
});

export function startProxyServer(port: number) {
  proxyServer.listen(port, () => console.log(
    `[ProxyServer] PROXY_SERVER_STARTED\n` +
    `  Port : ${port}`
  ))
}

function makeResponse(status: number, reason: string, body: string = '') {
  return `HTTP/1.1 ${status} ${reason}\r\n` +
    `content-type: text/plain\r\n` +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    `connection: close\r\n` +
    `\r\n` +
    body;
}