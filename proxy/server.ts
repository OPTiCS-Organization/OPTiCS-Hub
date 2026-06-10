import net from 'net';
import { randomUUID } from 'crypto';
import { register, release } from '../tunnel/registry.ts';

const proxyServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  const token = randomUUID();

  const onData = (chunk: NonSharedBuffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) return;

    const header = buffer.subarray(0, idx).toString().split('\r\n')
    const hostLine = header.find(line => line.toLowerCase().startsWith('host:'));
    const serviceName = hostLine?.toLowerCase().replace('host: ', '').split(':')[0].split('.')[0];

    register(token, socket, buffer);
    socket.off('data', onData);
    socket.pause();
    console.log(token, serviceName);
  }

  const onClose = () => {
    release(token, socket)
  }

  const onError = (error: Error) => {
    console.error(error);
  }

  socket.once('close', onClose);
  socket.once('error', onError);
  socket.on('data', onData);
});

export function startProxyServer(port: number) {
  proxyServer.listen(port, () => console.log(`Proxy server is running on ${port}`))
}