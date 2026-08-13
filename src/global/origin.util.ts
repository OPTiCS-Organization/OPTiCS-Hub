import log from 'spectra-log';

/**
 * CORS_ORIGIN 환경변수를 허용 Origin 목록으로 파싱한다.
 *
 * ConfigModule이 .env를 읽는 시점이 모듈 로드 이후라 최초 호출 때 계산하고 캐시한다.
 */
let cachedOrigins: string[] | null = null;

function allowedOrigins(): string[] {
  if (cachedOrigins) return cachedOrigins;
  cachedOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return cachedOrigins;
}

/** CORS 설정에 넘길 허용 Origin 목록을 반환한다. */
export function allowedOriginList(): string[] {
  return allowedOrigins();
}

/** 요청 Origin이 허용 목록에 있는지 확인한다. */
export function isAllowedOrigin(origin: string | undefined): origin is string {
  return typeof origin === 'string' && allowedOrigins().includes(origin);
}

/**
 * CORS_ORIGIN이 비어 있으면 기동 시점에 경고한다.
 *
 * 허용 목록이 비면 Origin 검증이 모든 크로스 오리진 요청을 막으므로,
 * 설정 누락을 403 디버깅으로 발견하지 않도록 미리 알린다.
 */
export function warnIfOriginAllowlistEmpty(): void {
  if (allowedOrigins().length > 0) return;
  log('[{{ red : bold : Origin }}] CORS_ORIGIN이 비어 있습니다. 브라우저에서 오는 모든 상태 변경 요청과 소켓 연결이 거부됩니다.', 500, 'ERROR');
}
