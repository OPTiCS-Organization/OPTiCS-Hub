import { Socket } from "net";

const localClientSocket: Map<string, { socket: Socket, rest: Buffer, timer: NodeJS.Timeout }> = new Map();

export function register(token: string, socket: Socket, rest: Buffer, onTimeout: () => void) {
  const timer = setTimeout(() => {
    localClientSocket.delete(token);
    onTimeout();
  }, 10_000);
  localClientSocket.set(token, {socket, rest, timer});
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