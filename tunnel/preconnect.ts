/*
 * Agent가 미리 열어 두는 소켓(PRE)의 수락과 보관을 담당합니다.
 *
 * 소켓으로 들어오는 줄은 신뢰할 수 없는 TCP 소켓에서 파싱한 것이므로 타입을 검증합니다.,
 * 서명 검증은 Hub에 맡깁니다. 서명 비밀을 이 프로세스로 가져오지 않는 이유는 두 가지입니다.
 * 비밀이 Hub 밖으로 나가지 않고, 재전송 가드가 한 곳에만 있으면 됩니다.
 * 게이트웨이를 여러 대로 늘려도 nonce를 대수만큼 재사용할 수 없습니다.
 *
 * 수락된 소켓은 agentUuid별 풀에 들어가 OPEN을 기다립니다. 기다리는 동안 Agent가
 * 20초마다 PING을 보내오므로 PONG으로 답해 줍니다. 이건 keepalive와 달리 이 프로세스의 이벤트 루프가 아직 도는지를 Agent에게 알려 줍니다.
 */
import net from 'net';

/** Agent가 보내는 PRE 줄의 첫 토큰. */
export const PRECONNECT_VERB = 'tunnel:pre:v1';

const AGENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[0-9a-f]{32}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * agent 하나가 쌓아 둘 수 있는 유휴 소켓 상한.
 * Agent의 목표치는 10
 */
const MAX_POOL_PER_AGENT = 16;

/** agentUuid -> OPEN을 기다리는 유휴 소켓들. */
const pools = new Map<string, Set<net.Socket>>();

/**
 * PRE 줄을 받은 소켓을 처리한다.
 *
 * 검증에 실패하면 사유를 적어 보내고 닫는다. Agent는 그 사유로 다음 재시도 여부를 구분한다,
 */
export async function handlePreconnect(socket: net.Socket, line: string, rest: Buffer) {
  /*
   * Hub 검증을 기다리는 동안은 읽는 사람이 없다. 첫 줄을 읽으며 data 리스너를 뗀
   * 뒤라 스트림은 여전히 flowing 상태이고, 그대로 두면 이 사이에 들어온 바이트가
   * 버려진다. PONG 리더를 붙일 때 다시 흐른다.
   */
  socket.pause();

  // OPEN 이전에 Agent가 보내는 것은 PING뿐이다. 그 앞에 뭔가 붙어 왔다면 규약 위반이다.
  if (rest.length > 0) return reject(socket, 'protocol_error');

  const [, agentUuid, timestamp, nonce, signature] = line.split(' ');

  if (!agentUuid || !AGENT_UUID_PATTERN.test(agentUuid)) return reject(socket, 'malformed_agent_uuid');
  if (!nonce || !NONCE_PATTERN.test(nonce)) return reject(socket, 'missing_nonce');
  if (!signature || !SIGNATURE_PATTERN.test(signature)) return reject(socket, 'malformed_signature');

  const parsedTimestamp = Number(timestamp);
  if (!Number.isInteger(parsedTimestamp)) return reject(socket, 'missing_timestamp');

  const verification = await verifyWithHub({ agentUuid, timestamp: parsedTimestamp, nonce, signature });
  if (!verification.ok) return reject(socket, verification.reason);

  const pool = pools.get(agentUuid) ?? new Set<net.Socket>();
  if (pool.size >= MAX_POOL_PER_AGENT) return reject(socket, 'pool_full');

  pool.add(socket);
  pools.set(agentUuid, pool);

  socket.once('close', () => {
    pool.delete(socket);
    if (pools.get(agentUuid) === pool && pool.size === 0) pools.delete(agentUuid);
  });

  socket.write('PRE:OK\n');
  answerHeartbeat(socket);

  console.log(`Preconnect accepted. agent=${agentUuid} pooled=${pool.size}`);
}

/**
 * 풀에서 유휴 소켓 하나를 꺼낸다. 꺼낸 소켓은 더 이상 풀 소유가 아니다.
 *
 * 꺼내는 쪽이 곧바로 OPEN 줄을 써서 Agent에게 용도를 알려 줘야 한다.
 */
export function claimPreconnected(agentUuid: string): net.Socket | undefined {
  const pool = pools.get(agentUuid);
  if (!pool) return undefined;

  for (const socket of pool) {
    pool.delete(socket);

    /*
     * 죽은 소켓을 꺼내 주면 그 요청 하나가 폴백으로 떨어진다.
     * 정상적으로 사용 가능한 소켓이 남아 있는데도 느린 경로를 사용하는 것이므로,
     * 정상적으로 사용 가능한 소켓을 만날 때까지 넘긴다.
     */
    if (socket.destroyed || !socket.writable) continue;

    // 하트비트 리더를 떼지 않으면 OPEN 이후의 바이트를 라인으로 잘못 읽는다.
    detachHeartbeat(socket);
    return socket;
  }

  if (pool.size === 0) pools.delete(agentUuid);
  return undefined;
}

/** 헬스 응답에 실을 숫자. 판정에는 쓰지 않고 보여주기만 한다. */
export function preconnectStats() {
  let pooledSockets = 0;
  for (const pool of pools.values()) pooledSockets += pool.size;
  return { agentsPreconnected: pools.size, pooledSockets };
}

async function verifyWithHub(
  body: { agentUuid: string; timestamp: number; nonce: string; signature: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`${process.env.HUB_API_URL}/v1/tunnel/preconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.TUNNEL_INTERNAL_SECRET ?? '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return { ok: false, reason: 'hub_rejected' };

    const result = await response.json() as { ok?: unknown; reason?: unknown };
    if (result?.ok === true) return { ok: true };
    return { ok: false, reason: typeof result?.reason === 'string' ? result.reason : 'hub_rejected' };
  } catch {
    /*
     * Hub에 못 닿은 것은 Agent 잘못이 아니다. Agent가 이 사유를 치명적 거절로 보지 않고 백오프 재시도를 하도록, 서명 실패와 다른 이름을 준다.
     */
    return { ok: false, reason: 'hub_unreachable' };
  }
}

/**
 * 유휴 소켓에 오는 PING에 PONG으로 답한다.
 *
 * TCP는 바이트 스트림이라 data 하나가 줄 하나라는 보장이 없으므로 \n까지 모았다가 본다.
 */
function answerHeartbeat(socket: net.Socket) {
  let buffer = Buffer.alloc(0);

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      const index = buffer.indexOf(0x0a);
      if (index === -1) return;

      const line = buffer.subarray(0, index).toString('utf8').trim();
      buffer = buffer.subarray(index + 1);

      if (line === 'PING') socket.write('PONG\n');
      else console.warn(`Unexpected frame on an idle preconnect socket: ${line}`);
    }
  };

  heartbeatReaders.set(socket, onData);
  socket.on('data', onData);
  socket.resume();
}

function detachHeartbeat(socket: net.Socket) {
  const onData = heartbeatReaders.get(socket);
  if (!onData) return;

  socket.off('data', onData);
  heartbeatReaders.delete(socket);

  // 리스너를 떼도 스트림은 flowing으로 남는다. 꺼낸 쪽이 pipe를 걸 때까지 흘려보내면
  // 그 사이 바이트가 버려지므로 멈춰 둔다. pipe가 알아서 다시 흐르게 한다.
  socket.pause();
}

/** 소켓을 꺼낼 때 리스너를 떼려면 그 함수를 기억해 둬야 한다. */
const heartbeatReaders = new WeakMap<net.Socket, (chunk: Buffer) => void>();

function reject(socket: net.Socket, reason: string) {
  console.warn(`Preconnect rejected. reason=${reason}`);
  socket.end(`PRE:ERR ${reason}\n`);
}
