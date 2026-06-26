# Cloudflare - DNS 레코드 생성 API 요약

> 작성일: 2026-06-25

존(zone)에 새 DNS 레코드를 생성하는 엔드포인트. 요청/응답 중심 정리.

## 엔드포인트

```
POST /zones/{zone_id}/dns_records
```

### 주의사항
- A/AAAA 레코드는 같은 이름의 CNAME과 공존 불가.
- NS 레코드는 같은 이름의 다른 타입과 공존 불가.
- 도메인명은 항상 Punycode로 표현됨 (유니코드로 만들어도).

---

## 요청 (Request)

### Path 파라미터

| 이름 | 타입 | 설명 |
|------|------|------|
| `zone_id` | string | 존 식별자 |

> 업데이트(PATCH)와 달리 `dns_record_id`가 없다 (아직 생성 전이므로).

### Body

레코드 타입별로 구조가 다름 (A / AAAA / CNAME / MX / NS / TXT / CAA / SRV 등 21종).
아래는 **A 레코드** 기준 핵심 필드.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `type` | `"A"` | ● | 레코드 타입 |
| `name` | string | ● | 전체 도메인명 (존 이름 포함, Punycode) |
| `ttl` | number \| `1` | ● | TTL(초). `1`이면 자동. 범위 60~86400 (Enterprise는 최소 30) |
| `content` | string | | 레코드 값. A는 IPv4, CNAME은 hostname 등 |
| `proxied` | boolean | | Cloudflare 프록시(주황 구름) 통과 여부 |
| `comment` | string | | 메모 (DNS 응답엔 영향 없음) |
| `tags` | RecordTags[] | | 커스텀 태그 (DNS 응답엔 영향 없음) |
| `settings` | object | | `ipv4_only`, `ipv6_only` (프록시 레코드 한정) |

#### 타입별 차이 포인트
- **CNAME**: `content`는 hostname (레코드 name과 같으면 안 됨), `settings.flatten_cname` 추가 가능.
- **MX**: `priority` (낮을수록 우선), `content`는 메일 서버 hostname.
- **TXT**: `content`는 따옴표로 감싼 문자열, 255바이트 초과 시 자동 분할.
- **CAA / SRV / DS / DNSKEY 등**: `content` 대신 `data` 객체로 세부 속성 지정.

---

## 응답 (Response)

업데이트(PATCH)와 동일한 구조. 생성된 레코드 전체가 `result`로 반환됨.

```jsonc
{
  "success": true,          // API 성공 여부
  "errors": [],             // { code, message, documentation_url, source }
  "messages": [],           // { code, message, documentation_url, source }
  "result": {               // RecordResponse (요청 body + 서버 생성 메타)
    "id": "...",            // 새로 발급된 레코드 식별자
    "name": "...",
    "type": "A",
    "content": "...",
    "ttl": 1,
    "proxied": false,
    "proxiable": true,      // 프록시 가능 여부
    "created_on": "...",    // 생성 시각
    "modified_on": "...",   // 최종 수정 시각
    "meta": {},             // Cloudflare 내부 메타 정보
    "comment_modified_on": "...",  // 코멘트 있을 때만
    "tags_modified_on": "..."      // 태그 있을 때만
  }
}
```

### 응답 필드 요약

| 필드 | 설명 |
|------|------|
| `success` | 항상 `true` (성공 시) |
| `errors[]` | 에러 목록. `code`, `message`, `documentation_url`, `source.pointer` |
| `messages[]` | 안내 메시지. 구조는 errors와 동일 |
| `result` | 생성된 레코드 전체. 요청 body 필드 + 아래 서버 생성 필드 |

### result에 추가되는 서버 생성 필드

| 필드 | 설명 |
|------|------|
| `id` | 새로 발급된 레코드 식별자 |
| `created_on` | 생성 시각 |
| `modified_on` | 최종 수정 시각 |
| `proxiable` | 프록시 가능 여부 |
| `meta` | Cloudflare 내부 정보 |
| `comment_modified_on` | 코멘트 최종 수정 시각 (없으면 생략) |
| `tags_modified_on` | 태그 최종 수정 시각 (없으면 생략) |

---

## 업데이트(PATCH)와의 차이

| 구분 | 생성 (POST) | 업데이트 (PATCH) |
|------|-------------|------------------|
| 메서드/경로 | `POST /zones/{zone_id}/dns_records` | `PATCH /zones/{zone_id}/dns_records/{dns_record_id}` |
| Path 파라미터 | `zone_id` | `zone_id` + `dns_record_id` |
| 동작 | 새 레코드 생성 | 보낸 필드만 부분 갱신 |
| Body / Response | 동일 구조 | 동일 구조 |
