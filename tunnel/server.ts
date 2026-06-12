import net from 'net'
import { claim, register, release } from './registry.ts';

const controlServer = net.createServer((socket) => {
  console.log('Local client connected to tunnel');

  let buffer = Buffer.alloc(0);
  let token = '';

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf(0x0a)  // \n의 바이트 값 0a
    if (idx == -1) return;

    token = buffer.subarray(0, idx).toString();
    const exist = claim(token);
    socket.off('data', onData);

    if (exist) {
      exist.socket.write(buffer.subarray(idx + 1));
      socket.write(exist.rest)

      socket.pipe(exist.socket);
      exist.socket.pipe(socket);

      socket.once('close', () => exist.socket.destroy());
      exist.socket.once('close', () => socket.destroy());

      console.log(`Token found and removing listener: ${token}`);
    } else {
      register(token, socket, buffer.subarray(idx + 1));
      console.log(`Token not found. hibernating until connection establishes.`);
      socket.pause();
    }

  };

  const onClose = () => {
    console.log(`Client disconnected. Expired token: ${token}`);
    release(token, socket);
  }

  const onError = (error: Error) => {
    console.error(error);
  }

  socket.once('error', onError);
  socket.once('close', onClose);
  socket.on('data', onData);
});

export function startTunnelServer(port: number) {
  controlServer.listen(port, () => { console.log(`Tunnel control server is running on port ${port}`) });
}