import { Socket } from "net";

const localClientSocket: Map<string, { socket: Socket, rest: Buffer, timer: NodeJS.Timeout }> = new Map();

export function register(token: string, socket: Socket, rest: Buffer, onTimeout: () => void) {
  console.log(
    `[TunnelRegistry] {{ green : bold : CONNECTION_REGISTERED }}\n` +
    `  Token : ${token}\n` +
    `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
  );
  const timer = setTimeout(() => {
    console.log(
      `[TunnelRegistry] {{ red : bold : CONNECTION_TIMEOUT }}\n` +
      `  Token : ${token}\n` +
      `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
    );
    localClientSocket.delete(token);
    onTimeout();
  }, 10_000);
  localClientSocket.set(token, { socket, rest, timer });
}

export function claim(token: string) {
  console.log(
    `[TunnelRegistry] {{ green : bold : AGENT_CONNECTION_CLAIMED }}\n` +
    `  Token : ${token}`
  );
  const entry = localClientSocket.get(token);
  clearTimeout(entry?.timer);
  localClientSocket.delete(token);
  console.log(
    `[TunnelRegistry] {{ red : bold : CONNECTION_RELEASED }}\n` +
    `  Token : ${token}`
  );
  return entry;
}

export function release(token: string, socket: Socket) {
  console.log(
    `[TunnelRegistry] {{ green : bold : CONNECTION_RELEASED }}\n` +
    `  Token : ${token}\n` +
    `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
  );
  if (localClientSocket.get(token)?.socket === socket) {
    clearTimeout(localClientSocket.get(token)!.timer);
    localClientSocket.delete(token);
  }
}