# 소켓 통신 계약

## Protocol Version 1

**v1은 "협상과 신원 증명이 생긴 계약"이다.**

v0([protocol_v0.md](./protocol_v0.md))에서 달라진 것만 적습니다. 여기서 언급하지 않은
이벤트·페이로드는 v0 문서가 그대로 유효합니다.

Hub는 `MINIMUM_PROTOCOL_VERSION`~`MAXIMUM_PROTOCOL_VERSION` 범위 밖의 Agent를 거부하며,
현재 두 값 모두 `1`입니다. 즉 **v0 Agent는 더 이상 접속하지 못합니다.**

| 구현 | 위치 |
| ---- | ---- |
| 버전 상수 (Agent) | `OPTiCS-Agent/src/global/protocol.ts` — `package.json`의 `optics.protocol`과 일치해야 하며 `protocol.spec.ts`가 강제한다 |
| 버전 게이트 (Hub) | `OPTiCS-Hub/src/agent/agent.gateway.ts` |
| 서명 유틸 | `OPTiCS-Agent/src/utility/hash.util.ts` = `OPTiCS-Hub/src/global/hash.util.ts` (바이트 단위로 동일) |
| 서명 부착 (Agent) | `createSocketEmitter.util.ts` |
| 서명 검증 (Agent) | `createSocketListener.util.ts` |
| 서명 부착·검증 (Hub) | `agent.gateway.ts`의 `sendToAgent` / `guardIncomingPackets` |

---

## 1. v0에서 달라진 것

### 1.1 `register` 요청에 필드가 추가되었다

```ts
// Agent → Hub
{
  agentUuid: string | null;
  agentVersion: string | null;
  protocolVersion: number;    // v1에서 추가. 없으면 Hub가 v0으로 간주해 거부한다
  _sig?: string;              // 서명 봉투. §2 참조
  _ts?: number;
  _nonce?: string;
}
```

### 1.2 `register` 응답이 결과 코드 봉투를 갖는다

v0에서는 성공 응답만 존재했고 거절 경로가 없었습니다(v0 문서 §5-1). v1의 응답은 항상
`{ code, data }` 형태입니다.

| `code` | `data` | Agent의 처리 |
| ------ | ------ | ------------ |
| `ok` | `Agent` (§1.3) | uuid·code·ip·signingSecret을 로컬 DB에 저장 |
| `deprecated_protocol_version` | `{ minimum, maximum }` | 재연결 중단. **Agent를 올려야 한다** |
| `unknown_protocol_version` | `{ minimum, maximum }` | 재연결 중단. **Hub를 올려야 한다** |
| `invalid_signature` | `{ reason }` | 재연결 중단. 저장된 비밀이 Hub의 것과 다르다 |
| `registration_failed` | `{ reason }` | 로그만 남기고 재연결은 계속한다 |

거절 코드는 `OPTiCS-Hub/src/agent/types/ResultCode.type.ts`가 유일한 정의이며,
Agent 쪽 수신 타입은 `src/interfaces/register-payload.interface.ts`입니다.

재연결을 멈추는 세 경우는 모두 **재시도로 풀리지 않는 상태**입니다. 3초 간격으로 계속
두들겨봐야 로그만 채우고 Hub에도 부담이 되므로 사람의 개입을 기다립니다.

### 1.3 `register` 응답의 `data`

```ts
type Agent = {
  code: string;                  // 사용자에게 보여주는 Agent 코드
  uuid: string;
  ip: string;
  parentWorkspace: number | null;
  signingSecret: string | null;  // §3 참조. 신규 발급 시에만 값이 실린다
};
```

> v0 문서 §5-2에 적힌 "ack 타입이 양쪽에서 다르다"는 문제는 v1에서 해소되었습니다.

---

## 2. 서명 봉투

`register`를 제외한 **모든 이벤트**는 양방향 모두 서명을 싣습니다.

```ts
{
  ...페이로드,
  _ts: number;      // 서명 시각 (epoch ms)
  _nonce: string;   // 16바이트 랜덤의 hex
  _sig: string;     // HMAC-SHA256 다이제스트의 소문자 hex
}
```

### 2.1 서명 대상 문자열

```
v{SIGNATURE_SCHEME_VERSION}\n{event}\n{_ts}\n{_nonce}\n{정규화된 페이로드}
```

예:

```
v1
service-status
1756000000000
fixednonce
{"nested":{"a":null,"z":[3,1,2]},"serviceIndex":7,"status":"running"}
```

- **`SIGNATURE_SCHEME_VERSION`은 프로토콜 버전과 별개다.** 서명 규칙만 바뀔 때 올린다.
  맨 앞에 박혀 있으므로 구버전 서명이 새 규칙으로 우연히 통과할 수 없다.
- **이벤트 이름이 들어간다.** 빠지면 `service-status`용 유효 서명을 그대로 `command`에
  옮겨 붙일 수 있다.
- **개행으로 잇는다.** 각 조각은 개행을 품을 수 없다 — 이벤트 이름과 nonce는 우리가 만드는
  값이고, 정규화 JSON은 실제 개행을 `\n`으로 이스케이프한다.

### 2.2 페이로드 정규화

`JSON.stringify`는 키 순서를 입력 순서 그대로 두므로, 양쪽의 조립 코드가 다르면 같은 내용이라도
다른 문자열이 나옵니다. 그래서 아래 규칙으로 결정적 직렬화를 합니다.

| 대상 | 규칙 |
| ---- | ---- |
| 객체 키 | 코드 유닛 오름차순으로 **재귀 정렬** (`Array#sort` 기본값) |
| 배열 | 순서가 의미이므로 **보존** |
| 객체의 `undefined` 값 | 키째로 제거 (`JSON.stringify`와 동일) |
| 배열 원소의 `undefined` | `null` (`JSON.stringify`와 동일) |
| `toJSON`을 가진 값 (`Date` 등) | `toJSON`을 먼저 적용 |
| `NaN` · `Infinity` | `null` (`JSON.stringify`와 동일) |
| `_sig` · `_ts` · `_nonce` | 서명 대상에서 **제외** (자기 자신을 서명할 수 없다) |
| 순환 참조 | `TypeError`를 던진다 |

### 2.3 검증

받은 쪽은 이 순서로 확인합니다. **순서가 계약의 일부입니다.**

1. `_sig`·`_ts`·`_nonce`의 존재와 형식
2. 다이제스트 재계산 후 **상수 시간 비교**
3. `_ts`가 허용 시계 오차(기본 5분) 안인지
4. `_nonce`가 처음 보는 값인지

서명 대조가 nonce 기록보다 **먼저**여야 합니다. 반대로 하면 공격자가 서명이 틀린 페이로드로
남의 nonce를 미리 태워 정상 요청을 재전송으로 오판하게 만들 수 있습니다.

### 2.4 검증 실패 시의 동작

| 상황 | 동작 |
| ---- | ---- |
| `register`의 서명 불일치 (Hub) | `invalid_signature` 응답 후 즉시 연결 종료 |
| 그 밖의 이벤트 (양방향) | **그 패킷만 폐기.** 연결은 유지한다 |

패킷만 버리는 이유는 정상 Agent도 시계 밀림으로 일시적으로 걸릴 수 있기 때문입니다.
그때 연결을 끊으면 3초 간격 재연결 폭풍이 됩니다. 신원 자체가 의심스러운 경우는 register에서
이미 걸러집니다.

실패를 보낸 쪽에 알리지 않습니다. 위조 패킷을 보낸 쪽에 무엇이 틀렸는지 알려줄 이유가 없습니다.

---

## 3. 서명 비밀의 수명

| 시점 | 동작 |
| ---- | ---- |
| 신규 Agent 등록 | Hub가 32바이트를 발급하고 `register` 응답에 실어 보낸다 |
| 기존 Agent 재등록 | 응답의 `signingSecret`은 `null`. Agent는 저장본을 유지한다 |
| 비밀이 없는 기존 Agent | Hub가 이번 등록에서 발급한다 (HMAC 도입 이전에 등록된 Agent) |

**이미 있는 비밀은 절대 덮어쓰지 않습니다.** 재발급은 곧 그 Agent의 신원 교체이고, 경합하는 두
소켓이 서로의 비밀을 무효화하는 상황을 만듭니다.

Agent는 비밀을 로컬 DB(`agentInfo` 테이블, 키 `agent-signing-secret`)에 저장하고 로그에는
남기지 않습니다. 로그를 읽을 수 있는 사람이 곧 그 Agent를 사칭할 수 있는 사람이 됩니다.

### 3.1 `register`가 서명 대상이 아닌 이유

최초 등록에서 Agent는 아직 비밀이 없고, Hub가 응답에 서명을 붙여봐야 대조할 재료가 없습니다.
이 부트스트랩 구간은 TLS(Agent가 Hub 인증서를 검증한다)에 기댑니다.

단, **UUID를 가지고 오는 Agent의 `register`는 서명해야 합니다.** UUID는 페이로드에 실려 오는
값이라 그것만 보고 등록하면 UUID를 아는 누구든 남의 Agent로 접속해 그 워크스페이스의 명령을
대신 받을 수 있습니다.

---

## 4. v0에서 그대로인 것

- 전송 계층(socket.io, `/agent` 네임스페이스, 재연결 3초)
- 이벤트 목록과 페이로드 (v0 문서 §3·§4)
- 중계 규칙 — `serviceIndex`를 가진 이벤트는 Hub가 매번 소유권을 검증한다
- `Command` 타입이 명령별로 분리되어 있지 않다는 점 (v0 문서 §5-6)

---

## 5. v1의 알려진 문제

1. **`tunnel-connect`만 snake_case다.** v0에서 넘어온 문제로 아직 그대로다.
2. **`response`에 상관 ID가 없다.** 어떤 명령의 응답인지 식별할 수 없다.
3. **`hash.util.ts`가 두 저장소에 복제되어 있다.** 파일 지문 테스트로 갈라짐을 막지만,
   한쪽 저장소만 보고 상수까지 함께 고치면 통과한다. 두 저장소를 함께 체크아웃해 비교하는
   CI가 있어야 완전히 닫힌다.
4. **비밀 회전 수단이 없다.** 유출됐을 때 할 수 있는 일은 Agent를 지우고 새로 등록하는 것뿐이다.
