import { startProxyServer } from "../proxy/server.ts";
import { startTunnelServer } from "./server.ts";

startTunnelServer(5220);
startProxyServer(10000);