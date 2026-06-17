import net from 'net'
import { claim, register, release } from './registry.ts';

/**
 * 에이전트의 연결을 받는 터널 서버
 * 역할
 * - 에이전트의 연결을 받아 터널 토큰을 발급하고 클라이언트와 에이전트 서비스 간 TCP 바이트 파이핑을 통해 통신
 */
const controlServer = net.createServer((socket) => {
  /**
   * 연결 수립 시 터널 토큰을 받을 버퍼 생성
   */
  let buffer = Buffer.alloc(0);
  let token = '';

  /**
   * 에이전트의 연결을 받아 터널 토큰을 발급하고 클라이언트와 에이전트 서비스 간 TCP 바이트 파이핑을 통해 통신
   */
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf(0x0a)  // \n의 바이트 값 0a
    if (idx == -1) return;

    token = buffer.subarray(0, idx).toString();
    const exist = claim(token);
    socket.off('data', onData);


    if (exist) {
      exist.socket.write(buffer.subarray(idx + 1));
      socket.write(exist.rest)

      socket.pipe(exist.socket);
      exist.socket.pipe(socket);

      console.log(
        `[TunnelServer] CONNECTION_ESTABLISHED\n` +
        `  Token : ${token}\n` +
        `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}\n` +
        `  Client Socket ID : ${exist.socketId}`
      );

      socket.once('close', () => exist.socket.destroy());
      exist.socket.once('close', () => socket.destroy());
    } else {
      register(token, socket, buffer.subarray(idx + 1), () => {
        console.log(
          `[TunnelServer] CONNECTION_TIMEOUT\n` +
          `  Token : ${token}\n` +
          `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
        );
        release(token, socket, 'timeout');
      });
      socket.pause();
    }

  };

  const onClose = () => {
    release(token, socket, 'agent_close');
    console.log(
      `[TunnelServer] CONNECTION_CLOSED\n` +
      `  Side : Agent\n` +
      `  Token : ${token}\n` +
      `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
    );
  }

  const onError = (error: Error) => {
    console.error(
      `[TunnelServer] AGENT_CONNECTION_ERROR\n` +
      `  Error : ${error}\n` +
      `  Token : ${token}\n` +
      `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
    );
  }

  socket.once('error', onError);
  socket.once('close', onClose);
  socket.on('data', onData);
});

export function startTunnelServer(port: number) {
  controlServer.listen(port, () => { console.log(
    `[TunnelServer] TUNNEL_SERVER_STARTED\n` +
    `  Port : ${port}`
  )});
}