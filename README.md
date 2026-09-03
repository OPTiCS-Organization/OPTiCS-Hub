# OPTiCS-Hub

OPTiCS의 중앙 서버입니다. NestJS(TypeScript) 기반이며, 하나의 저장소·하나의 Docker 이미지에서
서로 다른 두 프로세스(Hub API, Gateway)를 실행합니다.

## 역할

OPTiCS-Hub는 OPTiCS 플랫폼의 주 제어 계층입니다.

- **인증** — 이메일 인증 가입, 로그인, JWT 액세스/리프레시 토큰, 2FA(TOTP) 설정·검증(`src/auth/`).
- **워크스페이스 관리** — 사용자가 소유한 워크스페이스 생성·삭제, 서브도메인 활성화(`src/workspaces/`).
- **서비스 배포 지시** — 워크스페이스에 배포된 서비스(컨테이너 단위 구성 요소 포함)의 배포·재배포·시작·정지·삭제 명령을 Agent에게 전달(`src/services/`).
- **Agent 중계** — Agent(각 배포 대상 호스트에서 도는 에이전트 프로세스)와 Socket.IO로 상시 연결을 유지하며, Console(웹 프론트엔드)의 명령을 Agent로, Agent의 상태·로그를 Console로 중계(`src/agent/`).
- **공개 트래픽 라우팅** — `*.optics.run` / `*.*.optics.run`으로 들어오는 외부 HTTP 요청을 역방향 터널을 통해 올바른 Agent의 서비스로 전달(`tunnel/`, `proxy/`, `src/tunnel/`).
- **Agent 릴리즈 카탈로그** — GitHub Releases를 캐시해 Agent 원격 업데이트 가능 여부를 판정(`src/releases/`).

## 프로세스 구성

이 저장소의 이미지는 하나지만, `docker-compose.yml` 기준으로 서로 다른 커맨드로 두 컨테이너를 띄웁니다.

| 컨테이너  | 커맨드                                                             | 포트                                    | 역할                                              |
| --------- | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------- |
| `hub`     | `npx prisma migrate deploy && node dist/src/main` (Dockerfile CMD) | `3000`                                  | NestJS REST API + Socket.IO(`/agent`, `/console`) |
| `gateway` | `node tunnel/index.ts`                                             | `5220`(터널 제어), `10000`(공개 프록시) | Agent 역방향 터널 수신 + 외부 HTTP 요청 라우팅    |

`gateway`는 Nest 프레임워크를 쓰지 않는 순수 Node 스크립트입니다. `tunnel/index.ts`가
`startTunnelServer(5220)`와 `startProxyServer(10000)`를 함께 기동합니다(`tunnel/index.ts:1-5`).
빌드하지 않고 `.ts` 파일을 Node가 직접 실행하므로(Node 22+ 네이티브 TypeScript 스트리핑),
`Dockerfile`은 `tunnel/`·`proxy/`·`src/tunnel/tunnel-outcome.ts`(Hub와 게이트웨이가 공유하는
유일한 파일)만 원본 그대로 이미지에 복사합니다(`Dockerfile:26-33`).

`gateway`는 Hub API에 `HUB_API_URL`로 접근하며, 라우팅 판단(어느 Agent로 보낼지)은 전부 Hub가
내리고 게이트웨이는 TCP 바이트를 중계만 합니다.

## 모듈 구조

```
src/
├── agent/          Agent 연결 관리 — Socket.IO 게이트웨이 2개, 등록/서명 검증, 원격 업데이트 상태머신
│   ├── agent.gateway.ts        Hub ↔ Agent 소켓(/agent). 등록·서명 검증·명령 발신
│   ├── console.gateway.ts      Hub ↔ Console 소켓(/console). 룸 기반 브로드캐스트, 터미널 중계
│   ├── agent.service.ts        Agent 등록/조회, 연결 요청 수락·거부
│   └── agent-update.service.ts Agent 자기 교체(원격 업데이트) 상태머신
├── auth/            회원가입/로그인/JWT/2FA/이메일 인증
│   ├── auth.service.ts         가입·로그인·비밀번호 변경·이메일 인증 코드 발급/소진
│   ├── 2fa.service.ts          TOTP 등록·검증(otplib)
│   └── interceptor/            Guard(JwtGuard, TwoFactorGuard, PermissionGuard, InternalSecretGuard), Strategy, Cookie 처리
├── global/          공통 유틸 — 예외 필터, HMAC 서명(hash.util), semver 비교, Origin 검증, Socket.IO 어댑터
├── mailer/          Resend 기반 트랜잭션 메일 발송(이메일 인증)
├── releases/        Agent GitHub Releases 캐시(카탈로그), 설치 가능 여부 판정, 관리자 차단 API
├── services/        서비스(컨테이너) 배포·시작·정지·삭제·서브도메인/엔드포인트 관리
├── stats/           인증 없는 공개 플랫폼 통계(`/v1/stats/public`), 30초 인메모리 캐시
├── traffic/         Cloudflare GraphQL Analytics API에서 워크스페이스 트래픽을 매시간 동기화(`traffic_daily`)
├── tunnel/          공개 프록시 ↔ Agent 라우팅을 위한 내부 API(preconnect 서명 검증, connect 라우팅)
├── utility/         Cloudflare DNS 레코드 생성·수정·삭제, GraphQL Analytics 조회(워크스페이스 서브도메인용)
├── workspaces/      워크스페이스 CRUD, 서브도메인 활성화/비활성화, Agent 연결 요청
├── app.module.ts    루트 모듈
├── main.ts          부트스트랩(CORS, Origin 검사 미들웨어, URI 버저닝, Socket.IO 어댑터)
└── prisma.service.ts / prisma.module.ts   Prisma 클라이언트(@Global)

tunnel/              게이트웨이 프로세스 — 역방향 터널 제어 서버(:5220), preconnect 풀, 소켓 레지스트리
proxy/                게이트웨이 프로세스 — 공개 HTTP 진입점(:10000), 오류 페이지 렌더링
prisma/              스키마·마이그레이션
```

## REST API

`main.ts`에서 `VersioningType.URI`로 버전을 관리합니다. 모든 컨트롤러는 `@Controller({ path, version: '1' })`
형태이므로 실제 경로는 `/v1/<path>/...` 입니다. 인증이 필요한 라우트는 `JwtGuard`(쿠키의
`accessToken`)를 사용합니다.

### `/v1/auth` (`src/auth/v1/auth.controller.ts`)

| 메서드 | 경로                      | 설명                                    | 인증      |
| ------ | ------------------------- | --------------------------------------- | --------- |
| POST   | `/v1/auth/check-email`    | 이메일 가입 여부 확인                   | -         |
| POST   | `/v1/auth/verify`         | 가입용 인증 메일 발송(쿨다운 429)       | -         |
| POST   | `/v1/auth/verify/check`   | 인증 코드 유효성 확인                   | -         |
| POST   | `/v1/auth/verify/me`      | 기존 가입자 본인 인증 메일 재요청       | JWT       |
| POST   | `/v1/auth/verify/confirm` | 기존 가입자 이메일 인증 완료            | -         |
| POST   | `/v1/auth/register`       | 회원가입(+ 로그인 토큰 쿠키 발급)       | -         |
| POST   | `/v1/auth/login`          | 로그인(2FA 활성 시 `totpCode` 필요)     | -         |
| POST   | `/v1/auth/logout`         | 로그아웃(리프레시 토큰 폐기, 쿠키 삭제) | -         |
| POST   | `/v1/auth/2fa/setup`      | TOTP 시크릿 발급 + QR                   | JWT       |
| POST   | `/v1/auth/2fa/confirm`    | TOTP 코드 확인 후 2FA 활성화            | JWT       |
| DELETE | `/v1/auth/2fa/disconnect` | 2FA 비활성화(TOTP 코드 필요)            | JWT       |
| GET    | `/v1/auth/2fa`            | 2FA 활성 여부 조회                      | JWT       |
| POST   | `/v1/auth/2fa`            | 목적성 토큰(예: 웹 터미널용) 발급       | JWT + 2FA |
| GET    | `/v1/auth/me`             | 로그인 사용자 정보 조회                 | JWT       |
| PATCH  | `/v1/auth/password`       | 비밀번호 변경                           | JWT       |

### `/v1/workspace` (`src/workspaces/v1/workspace.controller.ts`)

| 메서드 | 경로                                                      | 설명                                                | 인증 |
| ------ | --------------------------------------------------------- | --------------------------------------------------- | ---- |
| POST   | `/v1/workspace/status/heartbeat`                          | 워크스페이스 서브도메인 heartbeat 수신(로그만 남김) | -    |
| POST   | `/v1/workspace`                                           | 워크스페이스 생성                                   | JWT  |
| POST   | `/v1/workspace/check-workspace-name`                      | 워크스페이스 이름 중복 확인                         | JWT  |
| GET    | `/v1/workspace`                                           | 내 워크스페이스 목록                                | JWT  |
| DELETE | `/v1/workspace/:workspaceIdx`                             | 워크스페이스 삭제(소유자명/이름 확인 문자열 필요)   | JWT  |
| POST   | `/v1/workspace/:workspaceIdx/connect`                     | Agent 코드로 연결 요청 전송                         | JWT  |
| DELETE | `/v1/workspace/:workspaceIdx/agent/:agentCode/disconnect` | 연결된 Agent 연결 해제                              | JWT  |
| DELETE | `/v1/workspace/:workspaceIdx/agent/:agentCode/cancel`     | 대기 중인 연결 요청 취소                            | JWT  |
| PATCH  | `/v1/workspace/:workspaceIdx/subdomain`                   | 워크스페이스 서브도메인 값 변경                     | JWT  |
| PATCH  | `/v1/workspace/:workspaceIdx/subdomain/active`            | 서브도메인 활성/비활성 토글(DNS 레코드 생성·삭제)   | JWT  |
| GET    | `/v1/workspace/:workspaceName`                            | 워크스페이스 상세(이름으로 조회)                    | JWT  |

### `/v1/service` (`src/services/v1/service.controller.ts`)

| 메서드 | 경로                                                        | 설명                                                 | 인증 |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------- | ---- |
| POST   | `/v1/service/deploy`                                        | 서비스 배포(`DEPLOY` 명령을 Agent로 전송)            | JWT  |
| GET    | `/v1/service/workspace/:workspaceIdx`                       | 워크스페이스의 서비스 목록(컴포넌트·엔드포인트 포함) | JWT  |
| DELETE | `/v1/service/:serviceIdx`                                   | 서비스 삭제(`deleteScope: containers\|service`)      | JWT  |
| POST   | `/v1/service/:serviceIdx/redeploy`                          | 재배포(다른 Agent로 이전 가능)                       | JWT  |
| POST   | `/v1/service/:serviceIdx/start`                             | 서비스 시작                                          | JWT  |
| POST   | `/v1/service/:serviceIdx/stop`                              | 서비스 정지                                          | JWT  |
| POST   | `/v1/service/:serviceIdx/containers/:containerName/start`   | 개별 컨테이너 시작                                   | JWT  |
| POST   | `/v1/service/:serviceIdx/containers/:containerName/stop`    | 개별 컨테이너 정지                                   | JWT  |
| POST   | `/v1/service/:serviceIdx/containers/:containerName/restart` | 개별 컨테이너 재시작                                 | JWT  |
| PATCH  | `/v1/service/:serviceIdx/subdomain`                         | 서비스 대표 서브도메인 변경                          | JWT  |
| PATCH  | `/v1/service/:serviceIdx/endpoints`                         | 서비스 엔드포인트(포트↔서브도메인 매핑) 전체 교체    | JWT  |

### `/v1/agent` (`src/agent/v1/agent.controller.ts`)

| 메서드 | 경로                                      | 설명                                                             | 인증 |
| ------ | ----------------------------------------- | ---------------------------------------------------------------- | ---- |
| GET    | `/v1/agent/workspace/:workspaceIdx`       | 워크스페이스에 연결/요청된 Agent 목록(업그레이드 가능 여부 포함) | JWT  |
| POST   | `/v1/agent/:agentUuid/update`             | Agent 원격 업데이트 요청                                         | JWT  |
| POST   | `/v1/agent/:agentUuid/update/acknowledge` | 업데이트 결과 배지 닫기(상태를 idle로)                           | JWT  |
| POST   | `/v1/agent/connect/accept`                | (Agent 대시보드에서 호출) 연결 요청 수락                         | -    |
| POST   | `/v1/agent/connect/reject`                | (Agent 대시보드에서 호출) 연결 요청 거절                         | -    |

### `/v1/release` (`src/releases/v1/release.controller.ts`)

| 메서드 | 경로                               | 설명                                                    | 인증                  |
| ------ | ---------------------------------- | ------------------------------------------------------- | --------------------- |
| GET    | `/v1/release/agent`                | Agent 릴리즈 카탈로그 조회(`?channel=beta`로 베타 포함) | JWT                   |
| POST   | `/v1/release/agent/:version/block` | 특정 버전 설치 차단(사고 대응)                          | JWT + `administrator` |
| DELETE | `/v1/release/agent/:version/block` | 운영자 차단 해제                                        | JWT + `administrator` |
| POST   | `/v1/release/agent/sync`           | GitHub Releases 즉시 재동기화                           | JWT                   |

### `/v1/stats` (`src/stats/v1/stats.controller.ts`)

인증도 쿠키도 없는 공개 API. 랜딩 사이트가 직접 호출하므로, 브라우저가 응답을 읽으려면
랜딩 사이트 Origin이 `CORS_ORIGIN`에 들어 있어야 한다(위 CORS_ORIGIN 항목 참고).

| 메서드 | 경로              | 설명                                          | 인증 |
| ------ | ----------------- | --------------------------------------------- | ---- |
| GET    | `/v1/stats/public` | 집계 지표만 담은 공개 플랫폼 통계(30초 캐시) | -    |

### `/v1/tunnel` (`src/tunnel/v1/tunnel.controller.ts`)

게이트웨이 프로세스 전용 내부 API입니다. 브라우저나 Console이 호출하지 않으며, `x-internal-secret`
헤더(`TUNNEL_INTERNAL_SECRET`)를 요구합니다(`InternalSecretGuard`).

| 메서드 | 경로                    | 설명                                                       | 인증        |
| ------ | ----------------------- | ---------------------------------------------------------- | ----------- |
| POST   | `/v1/tunnel/preconnect` | 게이트웨이가 받은 Agent의 PRE 서명을 검증                  | 내부 시크릿 |
| POST   | `/v1/tunnel/connect`    | 서브도메인으로 대상 Agent·포트를 조회하고 터널 연결을 지시 | 내부 시크릿 |

## WebSocket / Socket.IO

Origin 검증은 게이트웨이 데코레이터가 아니라 `OriginCheckingIoAdapter`(서버 단위 `allowRequest`)가
전담합니다(`src/global/socket.adapter.ts`). 두 네임스페이스가 있습니다.

### `/agent` 네임스페이스 — Hub ↔ Agent (`src/agent/agent.gateway.ts`)

Agent → Hub로 오는 이벤트는 `register`를 제외하고 전부 HMAC 서명이 필요하며, 서명 검증은
`client.use()` 미들웨어에서 모든 수신 이벤트에 대해 일괄 적용됩니다.

| 방향        | 이벤트                                                                              | 설명                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent → Hub | `register`                                                                          | 최초 등록/재등록. 프로토콜 버전 확인, 서명 검증(기존 Agent)                                                                                                                          |
| Agent → Hub | `response`                                                                          | 명령에 대한 응답을 해당 워크스페이스 Console로 그대로 중계                                                                                                                           |
| Agent → Hub | `system-metrics`                                                                    | Console의 메트릭 요청에 대한 응답                                                                                                                                                    |
| Agent → Hub | `terminal-ready` / `terminal-output` / `terminal-closed`                            | 웹 SSH 터미널 세션 상태·출력                                                                                                                                                         |
| Agent → Hub | `container-status`                                                                  | 컨테이너 목록/상태 보고 → `service_components` 동기화 후 Console로 중계                                                                                                              |
| Agent → Hub | `service-status`                                                                    | 서비스 상태 보고 → `services.service_status` 갱신 후 Console로 중계                                                                                                                  |
| Agent → Hub | `service-log` / `service-log-history` / `service-log-markers` / `log-load-progress` | 배포/런타임 로그 스트리밍                                                                                                                                                            |
| Agent → Hub | `update-log` / `update-failed`                                                      | 원격 업데이트 진행 로그·실패 보고                                                                                                                                                    |
| Hub → Agent | `command`                                                                           | `DEPLOY` / `REDEPLOY` / `DELETE` / `START` / `STOP` / `CONTAINER_START` / `CONTAINER_STOP` / `CONTAINER_RESTART` / `GET_CONTAINER_STATUS` / `STREAM_LOG` / `STOP_LOG` / `DISCONNECT` |
| Hub → Agent | `connect-request` / `connect-request-cancelled`                                     | 워크스페이스-Agent 연결 요청 알림/취소                                                                                                                                               |
| Hub → Agent | `tunnel-connect`                                                                    | 공개 프록시가 새 요청을 받았을 때 역방향 터널 개설 지시                                                                                                                              |
| Hub → Agent | `update-agent`                                                                      | 원격 업데이트 지시(대상 버전)                                                                                                                                                        |
| Hub → Agent | `terminal-open` / `terminal-input` / `terminal-resize` / `terminal-close`           | 웹 SSH 터미널 제어                                                                                                                                                                   |
| Hub → Agent | `system-metrics-request`                                                            | Console이 요청한 시스템 메트릭 조회                                                                                                                                                  |

### `/console` 네임스페이스 — Hub ↔ Console (`src/agent/console.gateway.ts`)

연결 시 쿠키의 `accessToken`을 검증하고, 워크스페이스 룸(`workspace:{index}`) 단위로 브로드캐스트합니다.

| 방향          | 이벤트                                                                                                                                   | 설명                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Console → Hub | `subscribe-workspace`                                                                                                                    | 워크스페이스 룸 참여 + 연결된 Agent에 컨테이너 상태 갱신 요청 |
| Console → Hub | `command`                                                                                                                                | Agent로 전달할 임의 명령(접근 권한 확인 후 중계)              |
| Console → Hub | `subscribe-log` / `unsubscribe-log`                                                                                                      | 서비스 로그 스트리밍 시작/중지                                |
| Console → Hub | `agent-metrics-request`                                                                                                                  | Agent 시스템 메트릭 요청(5초 타임아웃)                        |
| Console → Hub | `terminal-open`                                                                                                                          | 목적성 토큰(`TERMINAL_SSH`)으로 웹 SSH 세션 개설              |
| Console → Hub | `terminal-input` / `terminal-resize` / `terminal-close`                                                                                  | 웹 SSH 세션 제어                                              |
| Hub → Console | `agent-updated`                                                                                                                          | Agent 정보 갱신(연결/해제 등)                                 |
| Hub → Console | `agent-update`                                                                                                                           | 원격 업데이트 상태(phase) 변경                                |
| Hub → Console | `service-status` / `service-log` / `service-log-history` / `service-log-markers` / `log-load-progress` / `container-status` / `response` | Agent 이벤트를 워크스페이스 룸으로 그대로 중계                |
| Hub → Console | `agent-metrics`                                                                                                                          | 메트릭 요청 응답                                              |
| Hub → Console | `terminal-ready` / `terminal-output` / `terminal-closed`                                                                                 | 웹 SSH 세션 상태·출력                                         |

## 데이터 모델 (`prisma/schema.prisma`)

| 테이블               | 요약                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`              | 사용자 계정. 이메일/비밀번호, 권한(`UserPermission`: unverified/verified/moderator/administrator), TOTP 상태                                                      |
| `verification`       | 이메일 인증 코드(가입용/기존 사용자용 공용). 발급/최종 발송/소진 시각                                                                                             |
| `refresh_token`      | 리프레시 토큰 발급 이력(폐기는 `token_expired_at`로 표시, 로우 삭제 없음)                                                                                         |
| `workspaces`         | 사용자가 소유하는 배포 단위. 서브도메인(`*.optics.run`)과 활성 상태, DNS 레코드 ID 보유                                                                           |
| `agents`             | 배포 대상 호스트의 Agent. 연결 상태(`unlinked/requested/linked`), 온라인 상태, HMAC 서명 비밀, 프로토콜 버전, 원격 업데이트 상태(`AgentUpdatePhase`)              |
| `services`           | 워크스페이스 안에서 하나의 Agent에 배포된 서비스. 소스 URL(단일/복수 리포지토리 JSON), 배포 프리셋(`dockerfile`/`compose`/`preset_nestjs`), 상태(`ServiceStatus`) |
| `service_components` | 서비스를 구성하는 개별 컨테이너(compose면 여러 개). 상태·헬스·종료 코드를 개별 추적                                                                               |
| `service_endpoints`  | 서비스의 포트↔서브도메인 매핑. 컴포넌트별로 여러 개 등록 가능하며, 공개 서브도메인 라우팅의 실제 조회 대상                                                        |
| `agent_releases`     | GitHub Releases 캐시(Agent 릴리즈 카탈로그). 회수(`release_yanked_at`)와 두 종류의 차단(자산 선언 차단/운영자 수동 차단)을 구분 보관                              |
| `traffic_daily`      | Cloudflare GraphQL Analytics API에서 매시간 동기화한 워크스페이스 트래픽(호스트별 `edgeResponseBytes` 합)의 UTC 일별 스냅샷. 날짜가 PK라 재동기화해도 값이 쌓이지 않고 그날 값으로 교체됨(`/v1/stats/public`의 `trafficBytes`가 이 테이블의 최근 30일 합). Cloudflare 쪽 보존 기간은 이보다 짧을 수 있으므로(현재 존은 8일) 첫 백필은 그만큼만 채우고 나머지는 매시간 동기화가 하루씩 쌓아 나감. 실제로 몇 일치가 모였는지는 `trafficWindowDays`로 함께 내려감 |

관계 요약: `users 1—N workspaces`, `workspaces 1—N agents`(agent는 최대 하나의 워크스페이스에 연결),
`workspaces 1—N services`, `agents 1—N services`(서비스가 배포된 Agent), `services 1—N service_components`,
`services 1—N service_endpoints`(`workspaces`에도 직접 연결되어 서브도메인 라우팅 조회를 한 번에 처리).

## 환경 변수

`ConfigModule.forRoot({ isGlobal: true })`로 로드됩니다. "필수"는 `configService.getOrThrow(...)`로
읽거나, 해당 값이 없으면 앱이 부팅 시점에 예외를 던지는 provider가 즉시 생성되는 경우입니다
(`UtilityModule`·`MailerModule`은 다른 모듈이 참조하지 않아도 부팅 시 즉시 인스턴스화됩니다).

### Hub 프로세스

| 변수                                                                                        | 용도                                                                                                    | 필수                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`                                                                              | Prisma CLI(`migrate`/`generate`)가 사용(`prisma.config.ts`). 런타임 앱은 아래 `DATABASE_*` 개별 값을 씀 | 필수(Prisma CLI 실행 시)                      |
| `DATABASE_HOST` / `DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_PORT` / `DATABASE_NAME` | 런타임 DB 연결(`PrismaMariaDb` 어댑터, `src/prisma.service.ts`)                                         | 필수                                          |
| `SECURITY_JWT_SECRET`                                                                       | JWT 서명 키                                                                                             | 필수                                          |
| `SECURITY_ACCESS_TTL` (레거시 `SECURITY_ACCESS_EXPIRE_TIME`)                                | 액세스 토큰 TTL                                                                                         | 필수(둘 중 하나)                              |
| `SECURITY_REFRESH_TTL` (레거시 `SECURITY_REFRESH_EXPIRE_TIME`)                              | 리프레시 토큰 TTL                                                                                       | 필수(둘 중 하나)                              |
| `SECURITY_TERMINAL_SSH_TTL`                                                                 | 웹 SSH 목적성 토큰 TTL                                                                                  | 선택(기본 `2m`)                               |
| `SECURITY_VERIFY_REGISTER_TOTP_TTL`                                                         | 2FA 관련 목적성 토큰 TTL                                                                                | 선택(기본 `5m`)                               |
| `SECURITY_SALT_ROUND`                                                                       | bcrypt 솔트 라운드                                                                                      | 필수                                          |
| `TOTP_PERIOD_SECONDS`                                                                       | TOTP 주기(초)                                                                                           | 필수                                          |
| `TOTP_EPOCH_TOLERANCE_SECONDS`                                                              | TOTP 허용 시계 오차(초)                                                                                 | 필수                                          |
| `TUNNEL_INTERNAL_SECRET`                                                                    | 게이트웨이 ↔ Hub 내부 API(`/v1/tunnel/*`) 인증 시크릿                                                   | 필수                                          |
| `CORS_ORIGIN`                                                                               | 허용 Origin 목록(쉼표 구분). 비어 있으면 부팅 시 경고 로그 후 모든 브라우저 요청 차단. 랜딩 사이트가 `/v1/stats/public`을 폴링하려면 랜딩 Origin이 반드시 포함되어야 함(`src/stats/v1/stats.controller.ts`) | 필수(사실상)                                  |
| `SERVER_PORT`                                                                               | Hub API 리스닝 포트                                                                                     | 선택(기본 `3000`)                             |
| `RUNNING_MODE`                                                                              | `PRODUCTION`이면 쿠키 `secure: true`, `sameSite: 'none'`                                                | 선택                                          |
| `SENTRY_DSN`                                                                                | Sentry APM/오류 수집                                                                                    | 선택                                          |
| `CLOUDFLARE_API_KEY` / `CLOUDFLARE_ZONE_ID` / `OPTICS_HUB_IP`                               | 워크스페이스 서브도메인용 Cloudflare DNS 레코드 생성·수정·삭제(`src/utility/cloudflare.util.ts`). 존(Zone) 단위 **DNS Edit** 권한 필요 | 필수(부팅 시)                                 |
| `CLOUDFLARE_ANALYTIC_KEY`                                                                  | 공개 통계의 트래픽 값을 위해 GraphQL Analytics API를 호출(`src/utility/cloudflare-analytics.util.ts`). 존(Zone) 단위 **Analytics:Read** 권한만 있으면 되며, DNS 키와 일부러 분리한다 — 통계 조회는 읽기 전용이면 충분한데 DNS 키를 재사용하면 유출 시 레코드까지 조작 가능해진다. 없거나 권한이 모자라면 동기화가 조용히 실패하고 로그만 남으며 `/v1/stats/public`이 `trafficAvailable: false`로 내려감 | 필수(부팅 시)                                 |
| `SUBDOMAIN_ACTIVE_LIMIT`                                                                    | 동시에 활성화할 수 있는 워크스페이스 서브도메인 총량                                                    | 필수                                          |
| `AGENT_RELEASE_REPO`                                                                        | Agent 릴리즈를 가져올 GitHub 저장소(`owner/repo`)                                                       | 선택(기본 `OPTiCS-Organization/OPTiCS-Agent`) |
| `GITHUB_TOKEN`                                                                              | GitHub API 인증(없으면 시간당 60회 제한)                                                                | 선택(강력 권장)                               |
| `RESEND_SMTP_API_KEY`                                                                       | Resend 메일 발송 API 키                                                                                 | 필수(부팅 시)                                 |
| `MAIL_FROM_NOREPLY` / `MAIL_FROM_SUPPORT` / `MAIL_REPLY_TO`                                 | 발신 주소                                                                                               | 선택                                          |
| `CONSOLE_BASE_URL`                                                                          | 인증 메일 링크가 가리킬 Console 주소                                                                    | 선택(기본 `https://console.optics.run`)       |
| `MAIL_VERIFICATION_TTL_MINUTES`                                                             | 이메일 인증 코드 유효 시간(분)                                                                          | 선택(기본 `10`)                               |
| `MAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`                                                 | 인증 메일 재발송 쿨다운(초)                                                                             | 선택(기본 `90`)                               |

### Gateway 프로세스 (`tunnel/`, `proxy/`)

Nest의 `ConfigModule`을 쓰지 않고 `process.env`를 직접 읽습니다. `proxy/server.ts`는 기동 시
`dotenv.config({ path: '../OPTiCS-Infra/env/gateway.env' })`로 이 파일을 직접 읽습니다(저장소
바깥의 상대 경로이므로, `OPTiCS-Infra`가 형제 디렉터리로 체크아웃되어 있어야 합니다).

| 변수                     | 용도                                                                             | 필수 |
| ------------------------ | -------------------------------------------------------------------------------- | ---- |
| `HUB_API_URL`            | Hub API 베이스 URL(예: `http://hub:3000`)                                        | 필수 |
| `TUNNEL_INTERNAL_SECRET` | Hub `/v1/tunnel/*` 호출 시 `x-internal-secret` 헤더 값. Hub와 동일한 값이어야 함 | 필수 |

터널 제어 서버(`5220`)와 공개 프록시 서버(`10000`) 포트는 `tunnel/index.ts`에 하드코딩되어 있으며
환경 변수로 바꿀 수 없습니다(`tunnel/index.ts:4-5`).

## 로컬 실행

```bash
npm install

# .env 준비 (DB 접속 정보, SECURITY_*, TOTP_*, CLOUDFLARE_*, SUBDOMAIN_ACTIVE_LIMIT,
# RESEND_SMTP_API_KEY, TUNNEL_INTERNAL_SECRET 등 위 표의 "필수" 항목을 채워야 부팅됩니다.
# 리포 루트의 .env.example은 DB/JWT/CORS만 다루므로 나머지는 직접 추가해야 합니다.)
cp .env.example .env

# Prisma 클라이언트 생성 + 마이그레이션 적용
npx prisma generate
npx prisma migrate dev

# Hub API (:3000)
npm run start:dev

# Gateway (터널 :5220 + 공개 프록시 :10000) — 별도 터미널에서
npm run tunnel:dev
```

`docker-compose.yml` 기준으로는 `hub`/`gateway`/`console`/`mysql` 네 컨테이너를 함께 띄우며,
각 서비스는 `../OPTiCS-Infra/env/*.env`에서 환경 변수를 읽습니다(`docker-compose.yml:1-53`).
Hub 컨테이너는 기동 시 `npx prisma migrate deploy`를 자동으로 실행합니다(`Dockerfile:37`).

## 테스트

```bash
npm run test        # 단위 테스트 (src/**/*.spec.ts)
npm run test:e2e     # e2e 테스트 (test/*.e2e-spec.ts) — 프록시 오류 응답 형태 검증
npm run test:cov     # 커버리지
```

현재 단위/e2e 테스트가 존재하는 영역: HMAC 서명·검증(`src/global/hash.util.spec.ts`),
Agent 서명 시나리오(`src/agent/agent-signature.spec.ts`), Socket.IO Namespace 소켓 조회
(`src/agent/agent-socket-lookup.spec.ts`), JWT 리프레시 회전(`src/auth/util/jwt.util.spec.ts`),
semver 비교(`src/global/semver.util.spec.ts`), 공개 프록시의 오류 응답 형태(`test/gateway.e2e-spec.ts`).
