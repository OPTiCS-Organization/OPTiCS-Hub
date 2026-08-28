/*
 * Agent가 만든 서명을 Hub가 받아들이는지 확인하는 계약 테스트입니다.
 *
 * 양쪽 hash.util.ts는 서로의 사본이라 각자의 단위 테스트만으로는 어긋남을 잡지 못합니다.
 * (자기 규칙으로 만들고 자기 규칙으로 검증하니 언제나 통과한다)
 * 여기서는 Agent가 실제로 emit하는 모양 그대로 페이로드를 만들고 Hub 쪽 verify에 넣습니다.
 */
import { ReplayGuard, VERIFY_FAILURE, sign, verify } from '../global/hash.util';

const SECRET = 'a'.repeat(64);

describe('Agent 서명 ↔ Hub 검증', () => {
  it('Agent가 서명한 register를 Hub가 통과시킨다', () => {
    const signed = sign('register', { agentUuid: 'uuid-1', agentVersion: '0.6.0', protocolVersion: 1 }, SECRET);

    expect(verify('register', signed, SECRET)).toEqual({ ok: true });
  });

  it('UUID만 알고 비밀을 모르는 쪽의 register를 거부한다', () => {
    const forged = sign('register', { agentUuid: 'uuid-1', agentVersion: '0.6.0', protocolVersion: 1 }, 'b'.repeat(64));

    expect(verify('register', forged, SECRET))
      .toEqual({ ok: false, reason: VERIFY_FAILURE.INVALID_SIGNATURE });
  });

  it('서명을 아예 붙이지 않은 이벤트를 거부한다', () => {
    expect(verify('service-status', { serviceIndex: 1, status: 'running' }, SECRET))
      .toEqual({ ok: false, reason: VERIFY_FAILURE.MISSING_SIGNATURE });
  });

  // Agent는 서비스 로그처럼 optional 필드가 대거 undefined인 페이로드를 보낸다.
  it('undefined 필드가 섞인 페이로드도 양쪽이 같게 본다', () => {
    const signed = sign('service-log', {
      serviceIndex: 1,
      log: 'hello',
      timestamp: '2026-08-28T00:00:00.000Z',
      source: 'runtime',
      stream: undefined,
      containerName: undefined,
      stderr: false,
    }, SECRET);

    expect(verify('service-log', signed, SECRET)).toEqual({ ok: true });
  });

  it('가로챈 이벤트를 그대로 재전송하면 거부한다', () => {
    const replayGuard = new ReplayGuard();
    const signed = sign('command', { serviceIndex: 1 }, SECRET);

    expect(verify('command', signed, SECRET, { replayGuard })).toEqual({ ok: true });
    expect(verify('command', signed, SECRET, { replayGuard }))
      .toEqual({ ok: false, reason: VERIFY_FAILURE.REPLAYED });
  });

  // socket.io는 JSON으로 직렬화해 보내므로, 수신부가 보는 것은 원본 객체가 아니다.
  it('JSON 왕복을 거쳐도 서명이 유지된다', () => {
    const signed = sign('container-status', { serviceIndex: 1, containers: [{ name: 'a', status: 'running' }] }, SECRET);
    const overTheWire = JSON.parse(JSON.stringify(signed));

    expect(verify('container-status', overTheWire, SECRET)).toEqual({ ok: true });
  });
});
