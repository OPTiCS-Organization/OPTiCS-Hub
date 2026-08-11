import { Socket } from "net";

export type RequestDiagnostics = {
  requestId: string;
  startedAt: number;
  method: string;
  host: string;
  onTunnelSetup: () => void;
  onTtfb: () => void;
};

type RegistryEntry = {
  socket: Socket;
  rest: Buffer;
  timer: NodeJS.Timeout;
  diagnostics?: RequestDiagnostics;
};

const localClientSocket: Map<string, RegistryEntry> = new Map();

export function register(
  token: string,
  socket: Socket,
  rest: Buffer,
  onTimeout: () => void,
  diagnostics?: RequestDiagnostics,
) {
  const timer = setTimeout(() => {
    localClientSocket.delete(token);
    onTimeout();
  }, 10_000);
  localClientSocket.set(token, { socket, rest, timer, diagnostics });
}

export function claim(token: string) {
  const entry = localClientSocket.get(token);
  clearTimeout(entry?.timer);
  localClientSocket.delete(token);
  return entry;
}

export function release(token: string, socket: Socket) {
  if (localClientSocket.get(token)?.socket === socket) {
    clearTimeout(localClientSocket.get(token)!.timer);
    localClientSocket.delete(token);
  }
}
