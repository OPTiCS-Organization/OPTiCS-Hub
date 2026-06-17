import { Socket } from "net";

const localClientSocket: Map<string, { socket: Socket, socketId: string, rest: Buffer, timer: NodeJS.Timeout }> = new Map();

export function register(token: string, socket: Socket, rest: Buffer, onTimeout: () => void) {
  console.log(
    `[TunnelRegistry] CONNECTION_REGISTERED\n` +
    `  Token : ${token}\n` +
    `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
  );
  const timer = setTimeout(() => {
    console.log(
      `[TunnelRegistry] CONNECTION_TIMEOUT\n` +
      `  Token : ${token}\n` +
      `  Socket ID : ${socket.remoteAddress}:${socket.remotePort}`
    );
    localClientSocket.delete(token);
    onTimeout();
  }, 10_000);
  localClientSocket.set(token, { socket, socketId: socket.remoteAddress + ':' + socket.remotePort, rest, timer });
}

export function claim(token: string) {
  console.log(
    `[TunnelRegistry] CONNECTION_CLAIMED\n` +
    `  Token : ${token}`
  );
  const entry = localClientSocket.get(token);
  clearTimeout(entry?.timer);
  localClientSocket.delete(token);
  console.log(
    `[TunnelRegistry] CONNECTION_RELEASED\n` +
    `  Token : ${token}\n` +
    `  Found : ${entry ? 'true' : 'false'}\n` +
    `  Socket ID : ${entry?.socketId}`
  );
  return entry;
}

export function release(token: string, socket: Socket) {
  console.log(
    `[TunnelRegistry] CONNECTION_RELEASE\n` +
    `  Token : ${token}\n` +
    `  Found : ${localClientSocket.get(token) ? 'true' : 'false'}\n` +
    `  Same Socket : ${localClientSocket.get(token)?.socket === socket ? 'true' : 'false'}\n` +
    `  Socket ID : ${localClientSocket.get(token)?.socketId}`
  );
  if (localClientSocket.get(token)?.socket === socket) {
    clearTimeout(localClientSocket.get(token)!.timer);
    localClientSocket.delete(token);
  }
}