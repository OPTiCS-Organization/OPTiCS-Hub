/** 공통 응답 메시지/에러 항목 */
export interface CloudflareMessage {
  code: number;
  message: string;
  documentation_url?: string;
  source?: { pointer?: string };
}

/** 공통 응답 래퍼 */
export interface CloudflareResponse<T> {
  success: boolean;
  errors: CloudflareMessage[];
  messages: CloudflareMessage[];
  result: T;
}

/** A 레코드 응답 (생성/업데이트 result) */
export interface CloudflareARecordResult {
  id: string;
  name: string;
  type: "A";
  content: string;
  ttl: number;
  proxied: boolean;
  proxiable: boolean;
  comment?: string;
  tags: string[];
  meta: unknown;
  created_on: string;
  modified_on: string;
  comment_modified_on?: string;
  tags_modified_on?: string;
}

export type CreateDnsRecordResponse = CloudflareResponse<CloudflareARecordResult>;
export type UpdateDnsRecordResponse = CloudflareResponse<CloudflareARecordResult>;
/** 삭제는 result에 id만 반환 */
export type DeleteDnsRecordResponse = CloudflareResponse<{ id: string }>;
