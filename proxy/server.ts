import net from 'net';
import { randomUUID } from 'crypto';
import { register, release } from '../tunnel/registry.ts';
import dotenv from 'dotenv';
dotenv.config({ path: '../OPTiCS-Infra/env/hub.env' })

const proxyServer = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  const token = randomUUID();

  const onData = async (chunk: NonSharedBuffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf('\r\n\r\n');
    if (idx === -1) return;

    const header = buffer.subarray(0, idx).toString().split('\r\n')
    const hostLine = header.find(line => line.toLowerCase().startsWith('host:'));
    const serviceName = hostLine?.toLowerCase().replace('host: ', '').split(':')[0].split('.')[0];

    register(token, socket, buffer, () => {
      socket.end(makeResponse(504, 'Gateway Timeout'));
    });
    socket.off('data', onData);
    socket.pause();

    const body = {
      subdomain: serviceName,
      token: token
    }

    try {
      const response = await fetch('http://localhost:3000/v1/tunnel/connect', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.TUNNEL_INTERNAL_SECRET,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        socket.end(makeResponse(504, 'Gateway Timeout'));
      }
    } catch (error) {
      socket.end(makeResponse(504, 'Gateway Timeout'));
      console.log(error);
    }
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

function makeResponse(status: number, reason: string, body: string = '') {
  return `HTTP/1.1 ${status} ${reason}\r\n` +
    `content-type: text/plain\r\n` +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    `connection: close\r\n` +
    `\r\n` +
    body;
}