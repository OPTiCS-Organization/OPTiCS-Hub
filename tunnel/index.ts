import net, { Socket } from 'net'

let localClientSocket: Map<string, { socket: Socket, rest: Buffer }> = new Map();

const controlServer = net.createServer((socket) => {
  console.log('Local client connected to tunnel');

  let buffer = Buffer.alloc(0);
  let token = '';

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const idx = buffer.indexOf(0x0a)  // \n의 바이트 값 0a
    if (idx == -1) return;

    token = buffer.subarray(0, idx).toString();
    const exist = localClientSocket.get(token);
    socket.off('data', onData);

    if (exist) {
      localClientSocket.delete(token);

      exist.socket.write(buffer.subarray(idx + 1));
      socket.write(exist.rest)

      socket.pipe(exist.socket);
      exist.socket.pipe(socket);

      socket.once('close', () => exist.socket.destroy());
      exist.socket.once('close', () => socket.destroy());

      console.log(`Token found and removing listener: ${token}`);
    } else {
      localClientSocket.set(token, { socket: socket, rest: buffer.subarray(idx + 1) });
      console.log(`Token not found. hibernating until connection establishes.`);
      socket.pause();
    }

  };

  const onClose = (hadError: boolean) => {
    console.log(`Client disconnected. Expired token: ${token}`);
    if (localClientSocket.get(token)?.socket === socket)
      localClientSocket.delete(token);
  }

  const onError = (error: Error) => {
    console.error(error);
  }

  socket.once('error', onError);
  socket.once('close', onClose);
  socket.on('data', onData);
});

controlServer.listen(5220, () => { console.log('Tunnel control server is running on port 5220') });