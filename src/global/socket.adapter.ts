import { IoAdapter } from '@nestjs/platform-socket.io';
import type { IncomingMessage } from 'http';
import { allowedOriginList, isAllowedOrigin } from './origin.util';

/**
 * Socket.IO 서버에 Origin 검증을 붙이는 어댑터.
 *
 * `@WebSocketGateway({ cors })`는 이 프로젝트에서 두 가지 이유로 방어가 되지 않는다.
 * 1. engine.io의 cors 옵션은 응답 헤더만 붙일 뿐 요청을 거부하지 않고,
 *    브라우저는 WebSocket 핸드셰이크에 CORS를 적용하지 않는다. 클라이언트는 전부 websocket 전용이다.
 * 2. Nest는 socket.io 서버를 {port, path} 단위로 캐시하므로 같은 포트의 두 번째
 *    게이트웨이부터는 데코레이터 옵션이 버려진다. 즉 첫 게이트웨이 설정만 살아남는다.
 *
 * 핸드셰이크에서 실제로 연결을 거부할 수 있는 지점은 engine.io의 allowRequest뿐이고,
 * 이는 서버 단위 옵션이라 게이트웨이 등록 순서와 무관한 어댑터에서 지정한다.
 */
export class OriginCheckingIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: any): any {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOriginList(), credentials: true },
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null | undefined, success: boolean) => void,
      ) => {
        const origin = request.headers.origin;

        /**
         * Origin이 없는 요청은 Agent 프로세스 같은 비브라우저 클라이언트다.
         * 브라우저는 크로스 사이트 핸드셰이크에 Origin을 반드시 붙이므로,
         * Origin 부재는 피해자 쿠키를 실어 보낼 수 없는 호출임을 뜻한다.
         */
        callback(null, origin === undefined || isAllowedOrigin(origin));
      },
    });
  }
}
