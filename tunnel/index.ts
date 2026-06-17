import { startProxyServer } from "../proxy/server.ts";
import { startTunnelServer } from "./server.ts";

startTunnelServer(5220);  // 에이전트의 연결을 받는 포트
startProxyServer(10000);  // 클라이언트의 연결을 받는 서버 포트