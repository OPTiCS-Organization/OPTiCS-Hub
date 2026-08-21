# 소켓 통신 계약

## Protocol Version 0

**v0은 "프로토콜 협상이 존재하지 않던 시절의 계약"이다.**
`register`에 `protocol` 필드를 담지 않는 Agent는 모두 v0으로 간주한다.

이 문서는 Agent `0.5.3` / Hub `0.5.3` 시점에 **배포되어 동작 중인** 표면을 있는 그대로
받아적어 동결한 것입니다. 설계했어야 할 모습이 아니라 현재 모습이며, 적절하지 않은 부분도 그대로 둡니다.
v0의 정의는 협상의 기준점이므로 **이 문서는 앞으로 수정하지 않는다.** 변경은 v1 문서에서 다룹니다.

### 버전을 올리는 기준
| 변경                                 | bump |
| ------------------------------------ | ---- |
| 새 이벤트 추가                       | NO   |
| 기존 페이로드에 optional 필드 추가   | NO   |
| 이벤트 제거 / 개명                   | YES  |
| optional → required 승격, 타입 변경  | YES  |
| 이벤트 이름은 그대로인데 의미가 바뀜 | YES  |

> 판단 기준 : **구버전 Agent가 새 Hub에 붙었을 때 아무 일도 일어나지 않으면 bump가 아니다.**
따라서 새로 추가하는 이벤트·필드는 항상 optional로 설계하고, 구버전이 무응답이어도
Hub가 정상 동작해야 한다.

---

## 1. 전송 계층

| 항목           | 값                                                                               |
| -------------- | -------------------------------------------------------------------------------- |
| 라이브러리     | socket.io                                                                        |
| Namespace      | `/agent`                                                                         |
| 방향           | Agent가 Hub로 접속 (Agent = client, Hub = server)                                |
| 재연결         | `reconnection: true`, `reconnectionDelay: 3000`                                  |
| handshake auth | `{ agentUuid: string \| null }`                                                  |
| Agent 식별     | 접속 후 `register` 이벤트로 확정. handshake auth의 uuid는 disconnect 처리용 폴백 |

Hub는 연결 수락 시점엔 아무것도 하지 않고, Agent가 `register` 이벤트를 Emit 할 때 까지 대기함.

---

## 2. 공통 타입

```ts
type ServiceLogEntry = {
  line: string;
  timestamp?: string;                              // ISO 8601
  source?: 'hub' | 'agent' | 'runtime';
  stream?: 'deploy' | 'lifecycle' | 'runtime';
  containerName?: string;
  composeService?: string;
  stderr?: boolean;
};

type SessionMarker = {
  serviceIndex: number;
  serviceName: string;
  containerName: string;
  event: string;                                   // 예: 'service-deploy'
  timestamp: string;
};

type ContainerState = {
  name: string;
  status: string;                                  // ServiceStatus, 아래 §2.1
  service?: string;                                // compose service 이름
  exitCode?: number | null;
  health?: string | null;
};

type ServicePortMapping = { hostPort: number; containerPort: number };
type SourceRepository   = { url: string; rootDirectory?: string | null };
```

### 2.1 열거형

```ts
enum COMMAND {
  DEPLOY, REDEPLOY, ABORT, START, STOP,
  CONTAINER_START, CONTAINER_STOP, CONTAINER_RESTART,
  DELETE, DISCONNECT,
  STREAM_LOG, LOAD_OLDER_LOG, STOP_LOG, SYNC_CONTAINER_STATUS,
}

enum DEPLOY_OPTION { DOCKERFILE, COMPOSE, PRESET_NEST }
```

서비스 상태 문자열: `waiting` `building` `starting` `running` `stopped` `failed` `removed` `restarting`

> Hub는 `service-status` 수신 시 `restarting`을 제외한 7개만 DB에 반영하고, 나머지는 Console로만 중계한다.
> `container-status`의 컴포넌트 상태는 8개 전부 허용하며, 목록에 없는 값은 `stopped`로 정규화된다.

---

## 3. Events | Agent → Hub

| Event                 | Payload                                                                                                            | Description                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `register`            | `{ agentUuid: string \| null, agentVersion?: string \| null }`                                                     | 접속 직후 자신을 등록. `agentVersion`은 Agent의 `package.json` 버전이며 읽기 실패 시 `null` |
| `response`            | `unknown`                                                                                                          | 명령 처리 결과. Hub는 해석하지 않고 Console로 그대로 중계                                   |
| `system-metrics`      | `{ requestId: string, metrics: unknown }`                                                                          | `system-metrics-request`에 대한 응답                                                        |
| `terminal-ready`      | `{ sessionId: string }`                                                                                            | SSH 세션 수립 완료                                                                          |
| `terminal-output`     | `{ sessionId: string, data: string }`                                                                              | 터미널 출력                                                                                 |
| `terminal-closed`     | `{ sessionId: string, reason?: string }`                                                                           | 터미널 세션 종료                                                                            |
| `container-status`    | `{ serviceIndex: number, containers: ContainerState[], counts?: { running: number, total: number } }`              | 컨테이너 상태 스냅샷. Hub는 이걸로 `service_components`를 동기화                            |
| `service-status`      | `{ serviceIndex: number, status: string }`                                                                         | 서비스 단위 상태 전이                                                                       |
| `service-log`         | `{ serviceIndex: number, log: string, timestamp?, source?, stream?, containerName?, composeService?, stderr? }`    | 실시간 로그 1줄                                                                             |
| `log-load-progress`   | `{ serviceIndex: number, loaded: number, total: number, percent: number, phase: string }`                          | 과거 로그 적재 진행률                                                                       |
| `service-log-history` | `{ serviceIndex: number, logs: ServiceLogEntry[], markers?: SessionMarker[], before?: string, hasMore?: boolean }` | 과거 로그 묶음                                                                              |
| `service-log-markers` | `{ serviceIndex: number, markers: SessionMarker[] }`                                                               | 세션 구분 마커                                                                              |

### 중계 규칙

`register`를 제외한 모든 이벤트는 Hub가 **Console로 중계**하며, 그 과정에서 `agentCode`가 주입된다.

- `response`, `system-metrics`, `terminal-*` → Agent 소유자에게 직접 전달 (`agentCode` 주입 없음)
- 그 외 → 해당 워크스페이스로 브로드캐스트, 페이로드는 `{ agentCode, ...payload }`

`serviceIndex`를 가진 이벤트는 Hub가 **"그 서비스가 정말 이 Agent 소유인가"를 매번 검증**하고,
아니면 조용히 버린다. 즉 Agent는 자신에게 배정되지 않은 `serviceIndex`로 아무것도 할 수 없다.

---

## 4. Events | Hub → Agent

| Event                    | Payload                                                                                                                              | Description                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `register`               | `{ agentCode: string, agentUuid: string, agentIp: string, agentParentWorkspace: number \| null }`                                    | 등록 응답(ack). Agent는 code/uuid/ip를 로컬 DB에 저장          |
| `command`                | `Command` (아래)                                                                                                                     | 서비스 명령 일체                                               |
| `system-metrics-request` | `{ requestId: string }`                                                                                                              | 시스템 메트릭 요청                                             |
| `terminal-open`          | `{ sessionId: string, cols: number, rows: number }`                                                                                  | SSH 터미널 세션 시작                                           |
| `terminal-input`         | `{ sessionId: string, data: string }`                                                                                                | 터미널 입력. Agent는 64KB 초과 시 폐기                         |
| `terminal-resize`        | `{ sessionId: string, cols: number, rows: number }`                                                                                  | 터미널 크기 변경                                               |
| `terminal-close`         | `{ sessionId: string }`                                                                                                              | 터미널 세션 종료                                               |
| `connect-request`        | `{ workspaceOwnerName: string, workspaceName: string, workspaceCreatedAt: string, workspaceIndex: number, requestDatetime: string }` | 워크스페이스 연결 요청. Agent Dashboard에서 사용자가 수락/거절 |
| `tunnel-connect`         | `{ token: string, service_port: number, tunnel_port: number }`                                                                       | 일회성 Reverse Tunnel 연결 요청                                |

### 4.1 `command` 페이로드

```ts
type Command = {
  command: COMMAND;
  targetService: string;
  deployPreset: DEPLOY_OPTION;

  serviceIndex: number;
  serviceName: string;
  serviceVersion: string;
  sourceUrl: string | string[] | SourceRepository[];
  rootDirectory?: string | null;

  servicePort: number;
  serviceHostPort?: number;
  serviceContainerPort?: number;
  servicePortMappings?: ServicePortMapping[];

  containerName?: string;                          // CONTAINER_* 계열
  before?: string;                                 // LOAD_OLDER_LOG 커서
  limit?: number;                                  // LOAD_OLDER_LOG, 기본 1000
  deleteScope?: 'containers' | 'service';          // DELETE

  env: Record<string, string>;
};
```

모든 필드가 한 타입에 평평하게 모여 있고, 실제로는 `command` 값에 따라 일부만 채워진다.
예를 들어 `STOP_LOG`는 `serviceName`만, `DEPLOY`는 대부분을 사용한다.
**v0에서는 이 부분집합 관계가 타입으로 표현되지 않는다.**

### 4.2 명령별 응답

Agent는 `command` 처리 후 항상 `response`를 1회 emit한다.
단 대부분의 분기는 `response = {}`로 남으므로, 사실상 **완료 신호에 가깝고 결과 데이터가 아니다.**
실제 결과는 `service-status` / `service-log` / `container-status`로 따로 흐른다.

`DISCONNECT`는 예외적으로 Agent가 소켓을 스스로 끊는다.

---

## 5. v0의 알려진 문제

동결 대상이므로 **고치지 않고 기록만 한다.** v1 설계 시 입력으로 쓴다.

1. **`register`에 거절 경로가 없다.** Hub는 어떤 Agent든 무조건 등록하고 ack을 보낸다.
   버전이 맞지 않아도 거부할 수단이 없으며, Agent 쪽에도 "등록 실패" 상태가 존재하지 않는다.
   → 프로토콜 협상 도입 시 가장 먼저 생겨야 할 상태.

2. **`register` ack의 타입이 양쪽에서 다르다.** Hub는 `agentParentWorkspace`를 포함해 4개 필드를 보내지만,
   Agent의 수신 타입은 3개만 선언하고 있어 이 필드는 조용히 버려진다.

3. **`response`가 사실상 타입이 없다.** Hub는 `unknown`으로 받아 Console에 그대로 넘긴다.
   어떤 명령의 응답인지 식별할 상관 ID도 없다.

4. **날짜 타입이 섞여 있다.** `connect-request`에서 Hub는 `Date` 객체를 넘기지만
   Agent의 선언 타입은 `string`이다. socket.io의 JSON 직렬화 덕에 우연히 동작한다.

5. **`tunnel-connect`만 snake_case다.** 나머지 전 이벤트는 camelCase.
   또한 `tunnel_port: 5220`이 Hub에 하드코딩되어 있다.

6. **`Command`가 명령별로 분리되어 있지 않다.** §4.1 참고.

---

## 6. 계약에 포함되지 않는 것

아래는 Agent에 리스너가 존재하지만 **Hub에 발신부가 없어 한 번도 동작한 적이 없다.**
v0 계약에 포함하지 않으며, 하위호환 대상도 아니다. 구현 시점에 새로 설계한다.

| Event           | 현재 상태                                                                      |
| --------------- | ------------------------------------------------------------------------------ |
| `reverse-proxy` | Agent 리스너만 존재 (`RouteRequest`를 받아 `response`로 회신). Hub 발신부 없음 |
| `update-agent`  | Agent 리스너 존재하나 `AppService.updateAgent()`가 빈 스텁. Hub 발신부 없음    |

또한 다음은 Agent 내부 통신이며 Hub-Agent 계약이 아니다.

- Agent ↔ Agent Dashboard: `info`, `notification`, `service-status` (별도 게이트웨이)
- Reverse Tunnel의 TCP 와이어 포맷 (`tunnel-connect` 이후의 통신)
