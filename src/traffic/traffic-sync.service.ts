import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { CloudflareAnalyticsUtility } from 'src/utility/cloudflare-analytics.util';

/**
 * 워크스페이스 서브도메인 생성 시 막아 두는 예약어(CreateWorkspace.dto.ts /
 * UpdateWorkspaceSubdomain.dto.ts와 동일한 목록). 여기서도 그대로 복제해 쓴다 — 두 DTO도
 * 서로 import하지 않고 각자 복제해 두는 이 코드베이스의 기존 관례를 따른 것이다.
 *
 * 이 목록이 중요한 이유: `console.optics.run`은 라벨 개수만 보면 워크스페이스 루트 도메인
 * (`<workspace>.optics.run`)과 구별이 안 된다. 워크스페이스 서브도메인은 생성 시점에 이 목록과
 * 절대 겹치지 않게 막혀 있으므로, 여기서 같은 목록으로 걸러내면 플랫폼 자체 호스트가
 * 워크스페이스 트래픽으로 잘못 집계되는 일이 없다.
 */
const RESERVED_WORKSPACE_SUBDOMAINS = new Set(['api', 'docs', 'console', 'admin', 'tunnel', 'proxy']);

/**
 * Cloudflare가 돌려준 호스트네임이 워크스페이스 트래픽인지 판정한다.
 *
 * `<workspace>.optics.run`(3라벨) 또는 `<service>.<workspace>.optics.run`(4라벨) 모양만
 * 워크스페이스다. proxy/server.ts의 parseRouteFromHostHeader와 같은 모양 규칙이지만, 그 파일은
 * Nest를 쓰지 않는 별도 프로세스(Gateway)라 import로 공유할 수 없어 여기서 다시 구현한다
 * (tunnel-outcome.ts만 두 프로세스가 공유하는 유일한 파일이라는 README의 설명과 같은 이유).
 */
export function isWorkspaceHostname(hostname: string): boolean {
  const labels = hostname.trim().toLowerCase().split('.');
  if (labels.length !== 3 && labels.length !== 4) return false;
  if (labels.at(-2) !== 'optics' || labels.at(-1) !== 'run') return false;

  const workspaceLabel = labels.length === 3 ? labels[0] : labels[1];
  return !RESERVED_WORKSPACE_SUBDOMAINS.has(workspaceLabel);
}

/** 공개 통계가 노출하는 트래픽 창(일). StatsService도 같은 값을 쓴다. */
export const TRAFFIC_WINDOW_DAYS = 30;

/**
 * 공개 창(30일)보다 얼마나 더 오래 행을 보관할지의 여유분.
 *
 * 동기화가 한동안 밀렸다가(예: Cloudflare 장애) 뒤늦게 도는 회차가 창 경계에 걸친 날짜를
 * 여전히 바로잡을 수 있어야 한다. 정확히 30일만 보관하면 그 여유가 없다.
 */
const RETENTION_MARGIN_DAYS = 10;
const PRUNE_KEEP_DAYS = TRAFFIC_WINDOW_DAYS + RETENTION_MARGIN_DAYS;

/**
 * 정기 동기화 간격.
 *
 * 지표 자체가 하루 단위 집계라 1분 주기로 돌 이유가 없다. 너무 자주 돌리면 Cloudflare API
 * 쿼터만 소모한다. 시간당 한 번이면 Cloudflare 쪽 지연 집계가 안정된 뒤 몇 시간 안에는
 * 반영되고, 오늘 하루는 아직 집계 중이라 애초에 동기화 대상에 넣지 않는다.
 */
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

/** 매 회차 다시 확인하는 최근 며칠. Cloudflare 쪽 집계가 뒤늦게 정정되는 경우를 흡수한다. */
const RESYNC_TRAILING_DAYS = 3;

/**
 * 보존 기간을 물어보는 데 실패했을 때 첫 백필에 쓰는 보수적인 기본값(일).
 *
 * 크게 잡으면 실제 보존 기간을 넘는 날짜까지 조회하게 되고, 만약 Cloudflare가 그런 날짜에
 * 에러 없이 빈 결과만 돌려준다면 "데이터 없음"이 "트래픽 0"으로 잘못 기록될 위험이 있다.
 * 반대로 작게 잡으면 최초 창이 며칠치밖에 안 채워지는 것으로 끝나지만, 이건 다음 회차들이
 * 스스로 채워 나가므로 안전한 쪽의 실패다.
 */
const FALLBACK_BACKFILL_DAYS = 7;

/**
 * 보존 창 경계에서 물러서는 여유.
 *
 * 조회를 만드는 시각과 Cloudflare가 그 조회를 평가하는 시각이 다르고(왕복 지연), 서버 시계도
 * 정확히 같지 않다. 경계에 딱 붙여 요청하면 그 몇 초 차이로 통째로 거절당한다.
 */
const RETENTION_SAFETY_MS = 15 * 60 * 1000;

/** 어제부터 거꾸로 `days`일. 오늘은 Cloudflare 집계가 아직 끝나지 않은 하루라 넣지 않는다. */
export function trailingDateList(nowMs: number, days: number): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * 보존 창 안에 **하루가 통째로** 들어가는 날짜만 고른다.
 *
 * 보존 창은 '지금'을 기준으로 뒤로 미끄러지는데, 우리가 조회하는 단위는 자정~자정의 하루다.
 * 그래서 창 길이를 일수로 내림해 그만큼 거슬러 올라가면 가장 오래된 하루의 **시작(자정)**이
 * 창 밖으로 삐져나간다. 실제로 8일(1w1d) 보존인 존에서 8일 전 자정을 요청했다가
 * `cannot request data older than 1w1d`로 거절당했다 — 지금 시각이 자정에서 멀어질수록 더 많이
 * 삐져나가므로, 자정 직후에는 통과하고 낮에는 실패하는 형태가 된다.
 *
 * 창에 걸치는 하루는 반만 받을 수 있어도 아예 버린다. 반나절치를 하루 행으로 저장하면 그 날은
 * 영구히 과소집계로 남는다 — 재동기화 대상은 최근 RESYNC_TRAILING_DAYS일뿐이라 다시 고쳐지지도 않는다.
 */
export function backfillDates(nowMs: number, retentionSeconds: number, maxDays: number): string[] {
  const earliestAllowedMs = nowMs - retentionSeconds * 1000 + RETENTION_SAFETY_MS;
  const spanDays = Math.min(Math.max(Math.ceil(retentionSeconds / 86400), 0), maxDays);

  return trailingDateList(nowMs, spanDays)
    .filter(date => Date.parse(`${date}T00:00:00Z`) >= earliestAllowedMs);
}

/**
 * Cloudflare GraphQL Analytics API에서 워크스페이스 트래픽(호스트당 edgeResponseBytes 합)을
 * 하루 단위로 끌어와 `traffic_daily`에 쌓는다.
 *
 * ReleaseCatalogService(src/releases/release-catalog.service.ts)와 같은 패턴을 그대로
 * 따른다 — setInterval 기반 자체 스케줄러, 동시 호출 dedupe(syncing), 실패를 삼켜 타이머
 * 콜백 밖으로 던지지 않음. 이 프로젝트에는 @nestjs/schedule이 없고, 이미 있는 이 패턴을
 * 새 의존성 없이 재사용하는 편이 낫다.
 */
@Injectable()
export class TrafficSyncService implements OnModuleInit, OnModuleDestroy {
  private syncTimer: NodeJS.Timeout | null = null;
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly cloudflareAnalyticsUtility: CloudflareAnalyticsUtility,
  ) { }

  onModuleInit() {
    /*
      토큰이 없으면 타이머를 아예 걸지 않는다. 매시간 실패 로그만 쌓는 스케줄러는 진짜
      장애를 덮는다 — 로그에 [Traffic Sync] 실패가 상수처럼 흐르면 아무도 그걸 읽지 않게 된다.
      이 상태에서 traffic_daily 는 비어 있고, /v1/stats/public 은 trafficAvailable: false 로
      내려가며, 랜딩은 트래픽 타일만 빼고 나머지 세 지표를 그대로 보여준다.
    */
    if (!this.cloudflareAnalyticsUtility.isConfigured) {
      /* 실패가 아니라 '이 기능을 끄고 뜬다'는 상태 보고라 ERROR 가 아니다. */
      log('[Traffic Sync] CLOUDFLARE_ANALYTIC_KEY is not set. Traffic sync is disabled and trafficAvailable will stay false.', 200, 'INFO');
      return;
    }

    void this.runScheduledSync();
    this.syncTimer = setInterval(() => void this.runScheduledSync(), SYNC_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  /**
   * 실패를 여기서 삼킨다. 타이머 콜백 밖으로 던지면 프로세스가 죽는다. Cloudflare 장애나
   * 토큰 문제는 다음 회차에 저절로 재시도되고, 그 사이에는 기존 traffic_daily 행이 그대로
   * 남아 /v1/stats/public이 마지막으로 알려진 값을 계속 내려준다.
   */
  private async runScheduledSync(): Promise<void> {
    try {
      await this.sync();
    } catch (error) {
      log(`[Traffic Sync] Scheduled sync failed: ${String(error)}`, 500, 'ERROR');
    }
  }

  /** 동시 호출이 겹쳐도 Cloudflare 왕복은 한 회차만 돈다. */
  async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    const existingDays = await this.prismaService.traffic_daily.count();
    const dates = existingDays === 0
      ? await this.backfillDateList()
      : trailingDateList(Date.now(), RESYNC_TRAILING_DAYS);

    for (const date of dates) {
      try {
        await this.syncOneDay(date);
      } catch (error) {
        // 하루 실패가 나머지 날짜까지 막으면 안 된다. Cloudflare 쪽 일시적 오류일 수 있다.
        log(`[Traffic Sync] Failed to sync ${date}: ${String(error)}`, 500, 'ERROR');
      }
    }

    await this.pruneOldRows();
  }

  /** 테이블이 비어 있을 때만(최초 실행) 호출된다. 실제로 있는 데이터를 최대한 채운다. */
  private async backfillDateList(): Promise<string[]> {
    const retentionSeconds = await this.cloudflareAnalyticsUtility.getHttpRequestsRetentionSeconds();

    if (retentionSeconds === null) {
      log(`[Traffic Sync] Could not read Cloudflare retention window; falling back to ${FALLBACK_BACKFILL_DAYS} days.`, 500, 'ERROR');
    }

    const effectiveSeconds = retentionSeconds ?? FALLBACK_BACKFILL_DAYS * 86400;
    const dates = backfillDates(Date.now(), effectiveSeconds, PRUNE_KEEP_DAYS);

    log(`[Traffic Sync] Backfilling ${dates.length} day(s) within a ${Math.round(effectiveSeconds / 86400 * 10) / 10}-day retention window.`, 200, 'INFO');
    return dates;
  }

  private async syncOneDay(dateUtc: string): Promise<void> {
    const startIso = `${dateUtc}T00:00:00Z`;
    const endIsoExclusive = this.nextDateUtc(dateUtc) + 'T00:00:00Z';

    const breakdown = await this.cloudflareAnalyticsUtility.getDailyBytesByHostname(startIso, endIsoExclusive);

    let totalBytes = 0n;
    for (const { hostname, bytes } of breakdown) {
      if (isWorkspaceHostname(hostname)) totalBytes += bytes;
    }

    /**
     * increment가 아니라 절대값으로 덮어쓴다(set).
     *
     * 같은 날짜를 몇 번을 다시 동기화해도(재시도, 정정 재수집) 그 행은 매번 "이번에 관측한 값"으로
     * 교체될 뿐 이전 값 위에 쌓이지 않는다. 재동기화가 총합을 부풀리면 안 된다는 요구사항이
     * 여기 이 한 줄에 달려 있다.
     */
    await this.prismaService.traffic_daily.upsert({
      where: { traffic_date: new Date(`${dateUtc}T00:00:00.000Z`) },
      create: { traffic_date: new Date(`${dateUtc}T00:00:00.000Z`), traffic_bytes: totalBytes },
      update: { traffic_bytes: totalBytes },
    });
  }

  private nextDateUtc(dateUtc: string): string {
    const d = new Date(`${dateUtc}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  /** 공개 창(30일)보다 넉넉히 더 오래 보관한다. 여유분의 이유는 RETENTION_MARGIN_DAYS 주석 참고. */
  private async pruneOldRows(): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - PRUNE_KEEP_DAYS);

    await this.prismaService.traffic_daily.deleteMany({
      where: { traffic_date: { lt: cutoff } },
    });
  }
}
