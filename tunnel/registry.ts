import { Socket } from "net";

const localClientSocket: Map<string, { socket: Socket, socketId: string, rest: Buffer, timer: NodeJS.Timeout }> = new Map();
type ReleaseReason = 'claim_cleanup' | 'proxy_close' | 'agent_close' | 'timeout';

function makeSocketId(socket: Socket) {
  const host = socket.remoteAddress ?? 'unknown';
  const port = socket.remotePort ?? 'unknown';
  return `${host}:${port}`;
}

export function register(token: string, socket: Socket, rest: Buffer, onTimeout: () => void) {
  const socketId = makeSocketId(socket);
  console.log(
    `[TunnelRegistry] CONNECTION_REGISTERED\n` +
    `  Token : ${token}\n` +
    `  Socket ID : ${socketId}`
  );
  const timer = setTimeout(() => {
    console.log(
      `[TunnelRegistry] CONNECTION_TIMEOUT\n` +
      `  Token : ${token}\n` +
      `  Socket ID : ${socketId}`
    );
    localClientSocket.delete(token);
    onTimeout();
  }, 10_000);
  localClientSocket.set(token, { socket, socketId, rest, timer });
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
    `  Reason : claim_cleanup\n` +
    `  Found : ${entry ? 'true' : 'false'}\n` +
    `  Socket ID : ${entry?.socketId ?? 'unknown'}`
  );
  return entry;
}

export function release(token: string, socket: Socket, reason: ReleaseReason) {
  const entry = localClientSocket.get(token);
  const sameSocket = entry?.socket === socket;
  const event = entry && sameSocket ? 'CONNECTION_RELEASED' : 'CONNECTION_RELEASE_SKIPPED';

  console.log(
    `[TunnelRegistry] ${event}\n` +
    `  Token : ${token}\n` +
    `  Reason : ${reason}\n` +
    `  Found : ${entry ? 'true' : 'false'}\n` +
    `  Same Socket : ${sameSocket ? 'true' : 'false'}\n` +
    `  Registered Socket ID : ${entry?.socketId ?? 'unknown'}\n` +
    `  Incoming Socket ID : ${makeSocketId(socket)}`
  );
  if (entry && sameSocket) {
    clearTimeout(entry.timer);
    localClientSocket.delete(token);
  }
}