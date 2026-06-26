# Cloudflare - DNS 레코드 삭제 API 요약

> 작성일: 2026-06-25

존(zone)의 특정 DNS 레코드를 삭제하는 엔드포인트. 요청/응답 중심 정리.

## 엔드포인트

```
DELETE /zones/{zone_id}/dns_records/{dns_record_id}
```

---

## 요청 (Request)

### Path 파라미터

| 이름 | 타입 | 설명 |
|------|------|------|
| `zone_id` | string | 존 식별자 |
| `dns_record_id` | string | 삭제할 레코드 식별자 |

> Body 없음. 인증 헤더만 필요.

### 예시

```http
curl https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$DNS_RECORD_ID \
    -X DELETE \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

---

## 응답 (Response)

삭제된 레코드의 `id`만 반환됨. (생성/업데이트처럼 전체 레코드 정보는 안 줌)

```json
{
  "result": {
    "id": "023e105f4ecef8ad9ca31a8372d0c353"
  }
}
```

### 응답 필드 요약

| 필드 | 타입 | 설명 |
|------|------|------|
| `result` | object | 삭제 결과 |
| `result.id` | string | 삭제된 레코드 식별자 |

---

## 다른 엔드포인트와의 차이

| 구분 | 생성/업데이트 | 삭제 (DELETE) |
|------|----------------|----------------|
| Request Body | 레코드 필드 전체 | 없음 |
| Response `result` | 레코드 전체 정보 | `id`만 |
