/*
 * Agent가 안쪽에서 바깥쪽으로 열어 주는 reverse tunnel 제어 서버입니다.
 *
 * Hub가 Agent에게 tunnel-connect 명령을 보내면 Agent는 이 서버로 TCP 연결을
 * 엽니다. Agent가 처음 보내는 한 줄은 공개 프록시 서버가 생성한 일회용 토큰입니다.
 *
 * 같은 토큰으로 대기 중인 공개 클라이언트 소켓이 이미 있으면 두 소켓을 즉시
 * 연결하고, 아직 없다면 Agent 소켓을 레지스트리에 잠시 보관했다가 프록시 쪽
 * 소켓이 도착했을 때 서로 이어 줍니다.
 */
import net from 'net'
import { PRECONNECT_VERB, handlePreconnect } from './preconnect.ts';
import { claim, register, release } from './registry.ts';

const controlServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let token = '';

  /**
   * Data case
   * PRE AGENT_UUID TIMESTAMP NONCE HASH\n: Agent 커넥션 풀 형성
   * OPEN TARGET_PORT REQ_ID\n: 존재하는 커넥션 풀에 연결 수립
   * CONNECT_TOKEN\n: 풀이 존재하지 않는 에이전트와 통신
  */
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf(0x0a)  // \n의 바이트 값 0a
    if (idx == -1) return;

    const line = buffer.subarray(0, idx).toString();
    socket.off('data', onData);

    /*
     * 아래 토큰을 사용한 소켓은 즉시 짝지어 파이핑하지만, 프리커넥팅은 OPEN이 올 때까지 살아 있어야 한다.
     */
    if (line.startsWith(`${PRECONNECT_VERB} `)) {
      // close 핸들러가 토큰 경로의 release를 부르지 않도록 떼어 낸다.
      socket.off('close', onClose);
      void handlePreconnect(socket, line, buffer.subarray(idx + 1));
      return;
    }

    token = line;
    const exist = claim(token);

    if (exist) {
      exist.diagnostics?.onTunnelSetup();

      const responseRemainder = buffer.subarray(idx + 1);
      if (responseRemainder.length > 0) {
        exist.diagnostics?.onTtfb();
      } else if (exist.diagnostics) {
        socket.once('data', exist.diagnostics.onTtfb);
      }

      exist.socket.write(responseRemainder);
      socket.write(exist.rest)

      socket.pipe(exist.socket);
      exist.socket.pipe(socket);

    } else {
      register(token, socket, buffer.subarray(idx + 1), () => onClose());
      console.log(`Token not found. hibernating until connection establishes.`);
      socket.pause();
    }

  };

  const onClose = () => {
    console.log(`Client disconnected. Expired token: ${token}`);
    release(token, socket);
  }

  const onError = (error: Error) => {
    console.error(error);
  }

  socket.once('error', onError);
  socket.once('close', onClose);
  socket.on('data', onData);
});

export function startTunnelServer(port: number) {
  controlServer.listen(port, () => { console.log(`Tunnel control server is running on port ${port}`) });
}
