import { Socket } from "net";

const localClientSocket: Map<string, { socket: Socket, rest: Buffer }> = new Map();

export function register(token: string, socket: Socket, rest: Buffer) {
  localClientSocket.set(token, {socket, rest});
}

export function claim(token: string) {
  const entry = localClientSocket.get(token);
  localClientSocket.delete(token);
  return entry;
}

export function release(token: string, socket: Socket) {
  if (localClientSocket.get(token)?.socket === socket) {
    localClientSocket.delete(token);
  }
}