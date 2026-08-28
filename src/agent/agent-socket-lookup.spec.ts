/*
 * `@WebSocketServer()`가 주입하는 객체에서 소켓을 어떻게 꺼내야 하는지를 못박는 테스트입니다.
 *
 * AgentGateway는 소켓의 `data.signingSecret`을 읽어야 해서 소켓 객체 자체가 필요합니다
 * (`server.to(socketId)`로는 data에 닿지 못한다). 그런데 namespace가 지정된 게이트웨이에는
 * Server가 아니라 Namespace가 주입되고, 둘은 소켓을 꺼내는 경로가 다릅니다.
 *
 *   Server.sockets    → Namespace       → .sockets.sockets.get(id)
 *   Namespace.sockets → Map<id, Socket> → .sockets.get(id)
 *
 * 선언 타입이 Server라 잘못된 경로도 타입 검사를 통과하고, 런타임에서만
 * "Cannot read properties of undefined (reading 'get')"으로 터집니다.
 * 실제로 한 번 그렇게 나갔던 자리라 형태를 테스트로 고정합니다.
 *
 * 연결을 실제로 맺지 않는 이유는, 깨졌던 것이 "소켓을 담는 그릇의 모양"이지
 * 연결 동작이 아니기 때문입니다. Hub에는 socket.io 클라이언트 의존성도 없습니다.
 */
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';

describe('namespace에서 소켓 꺼내기', () => {
  let httpServer: HttpServer;
  let server: Server;

  beforeAll(() => {
    httpServer = createServer();
    // AgentGateway와 같은 조건: namespace가 붙은 게이트웨이.
    server = new Server(httpServer);
  });

  afterAll(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  });

  it('Namespace.sockets는 소켓 Map이다', () => {
    const namespace = server.of('/agent');

    expect(namespace.sockets).toBeInstanceOf(Map);
  });

  it('Map에서 꺼낸 소켓으로 data에 닿을 수 있다', () => {
    const namespace = server.of('/agent');
    const fakeSocket = { id: 'socket-1', data: { signingSecret: 'secret-for-test' } };
    namespace.sockets.set('socket-1', fakeSocket as never);

    try {
      const socket = namespace.sockets.get('socket-1');
      expect(socket?.data.signingSecret).toBe('secret-for-test');
    } finally {
      namespace.sockets.delete('socket-1');
    }
  });

  // 이 줄이 실패하도록 바뀌면 socket.io가 형태를 바꾼 것이므로 getAgentSocket도 함께 봐야 한다.
  it('Server 기준 경로(sockets.sockets)는 Namespace에 존재하지 않는다', () => {
    const namespace = server.of('/agent') as unknown as { sockets: { sockets?: unknown } };

    expect(namespace.sockets.sockets).toBeUndefined();
  });

  // 왜 헷갈리는지를 남겨 둔다. Server에서는 한 단계가 더 있다.
  it('Server.sockets는 Map이 아니라 기본 Namespace다', () => {
    expect(server.sockets).not.toBeInstanceOf(Map);
    expect(server.sockets.sockets).toBeInstanceOf(Map);
  });
});
