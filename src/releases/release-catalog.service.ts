import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { SUPPORTED_PROTOCOL } from 'src/global/protocol';
import { compareSemver } from 'src/global/semver.util';

/** 릴리즈 자산으로 발행되는 메타데이터. Agent 저장소의 릴리즈 워크플로가 만든다. */
type ReleaseMetadata = {
  version: string;
  protocol: number;
  image: string;
  /**
   * 자산(release.json)이 선언한 차단 사유. 채워져 있으면 그 이유로 설치를 막는다.
   * 동기화할 때마다 자산 값으로 덮이며, 운영자가 건 차단(release_manual_block)과는 별개다.
   *
   * 릴리즈를 삭제해도 설치는 막히지만 패치노트와 이력까지 사라지고, 이미 그 버전을 돌리는
   * Agent에게 아무 설명도 남지 않는다. 여기에 이유를 남기면 목록에는 그대로 두고 설치만 막는다.
   */
  blocked: string | null;
};

type GithubAsset = { name: string; url: string };
type GithubRelease = {
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GithubAsset[];
};

const METADATA_ASSET = 'release.json';
const DEFAULT_REPO = 'OPTiCS-Organization/OPTiCS-Agent';
/**
 * 주기 동기화 간격.
 *
 * 이 간격이 곧 "릴리즈를 내거나 차단한 뒤 Console에 반영되기까지의 최대 지연"이다.
 * 짧을수록 GitHub API 호출이 그대로 늘어난다. 한 번 돌 때 릴리즈 목록 1회 +
 * release.json 자산 1회씩(릴리즈 수만큼)이 나가므로, GITHUB_TOKEN 없이는
 * 시간당 60회 제한에 바로 걸린다.
 */
const SYNC_INTERVAL_MS = 60 * 1000;
/**
 * 주기 동기화가 멈춘 경우에만 쓰이는 안전망.
 * 스케줄러가 살아 있으면 lastSyncedAt이 계속 갱신되어 이 경로는 타지 않는다.
 */
const FRESHNESS_MS = 15 * 60 * 1000;
/** 동기화가 실패한 뒤 다시 시도하기까지의 최소 간격. GitHub 장애 때 매 요청마다 때리지 않기 위한 것이다. */
const RETRY_BACKOFF_MS = 60 * 1000;

/**
 * Agent 릴리즈 카탈로그.
 *
 * GitHub Releases를 캐시하되, release.json 자산이 붙은 릴리즈만 받아들인다.
 * 그 자산은 이미지 푸시가 성공한 뒤에만 발행되므로 자산의 존재가 곧 이미지 존재의 영수증이고,
 * 덕분에 '패치노트는 보이는데 docker pull하면 죽는 버전'이 카탈로그에 오를 수 없다.
 *
 * 캐시는 기동 직후와 이후 SYNC_INTERVAL_MS 마다 갱신한다. 읽기 시점 갱신(ensureFresh)만
 * 두면 아무도 보지 않는 동안에는 캐시가 늙고, 차단을 건 직후처럼 즉시 퍼져야 하는 변경이
 * 다음 조회 때까지 반영되지 않는다.
 */
@Injectable()
export class ReleaseCatalogService implements OnModuleInit, OnModuleDestroy {
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncedAt = 0;
  private lastAttemptAt = 0;
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) { }

  onModuleInit() {
    // 기동 직후 한 번 채워 둔다. 첫 조회가 GitHub 왕복을 기다리지 않게 하려는 것이다.
    void this.runScheduledSync();
    this.syncTimer = setInterval(() => void this.runScheduledSync(), SYNC_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  /**
   * 주기 동기화 한 회차.
   *
   * 실패를 삼키는 이유는 여기서 던지면 타이머 콜백 밖으로 나가 프로세스를 죽이기 때문이다.
   * GitHub 장애나 요청 한도 초과는 다음 회차에 저절로 회복되므로, 남은 캐시를 계속 쓰면 된다.
   */
  private async runScheduledSync(): Promise<void> {
    try {
      await this.sync();
    } catch (error) {
      log(`[Release Catalog] Scheduled sync failed: ${String(error)}`, 500, 'ERROR');
    }
  }

  private get repo(): string {
    return this.configService.get<string>('AGENT_RELEASE_REPO') ?? DEFAULT_REPO;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    // 퍼블릭 저장소라도 토큰을 붙인다. 없으면 시간당 60회로 묶여 동기화가 실패한다.
    const token = this.configService.get<string>('GITHUB_TOKEN');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /** 캐시가 오래됐으면 동기화한다. 스케줄러 없이 신선도를 유지하는 자리다. */
  async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastSyncedAt < FRESHNESS_MS) return;
    if (Date.now() - this.lastAttemptAt < RETRY_BACKOFF_MS) return;
    this.lastAttemptAt = Date.now();
    try {
      await this.sync();
    } catch (error) {
      // 동기화 실패가 조회 실패가 되어서는 안 된다. 오래된 캐시라도 보여주는 편이 낫다.
      log(`[Release Catalog] Sync failed, serving cached data: ${String(error)}`, 500, 'ERROR');
    }
  }

  /** 동시 요청이 겹쳐도 GitHub 왕복은 한 번만 돈다. */
  async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  /**
   * 실패한 응답에서 사람이 읽을 원인을 뽑아낸다.
   *
   * 403 하나만 남기면 "한도 초과"인지 "토큰이 이 저장소에 접근 못 함"인지 구분할 수 없다.
   * 둘은 대응이 완전히 다르고(기다리기 vs 토큰 권한 수정), GitHub은 그 답을 본문 message와
   * x-ratelimit 헤더에 이미 담아 보낸다. 버리지 않고 로그까지 끌고 간다.
   */
  private async failureDetail(response: Response): Promise<string> {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limit = response.headers.get('x-ratelimit-limit');
    const reset = response.headers.get('x-ratelimit-reset');

    let message = '';
    try {
      const body = (await response.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // 본문이 JSON이 아닐 수 있다. 그때는 헤더만으로 충분하다.
    }

    const parts: string[] = [];
    if (message) parts.push(message);
    // remaining이 0이면 한도 문제, 남아 있는데 403이면 권한 문제다. 이 한 줄이 갈림길이 된다.
    if (remaining !== null) parts.push(`ratelimit ${remaining}/${limit ?? '?'}`);
    if (remaining === '0' && reset) {
      parts.push(`resets at ${new Date(Number(reset) * 1000).toISOString()}`);
    }
    parts.push(`auth ${this.configService.get<string>('GITHUB_TOKEN') ? 'token' : 'anonymous'}`);

    return `(${parts.join(', ')})`;
  }

  private async runSync(): Promise<void> {
    const response = await fetch(
      `https://api.github.com/repos/${this.repo}/releases?per_page=100`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `GitHub releases fetch failed: ${response.status} ${await this.failureDetail(response)}`,
      );
    }

    const releases = (await response.json()) as GithubRelease[];
    const seen: string[] = [];
    let oldestSeen: Date | null = null;

    for (const release of releases) {
      if (release.draft || !release.published_at) continue;

      const asset = release.assets.find((a) => a.name === METADATA_ASSET);
      if (!asset) continue;                                 // 이미지가 없는 릴리즈다. 노출하지 않는다.

      const metadata = await this.fetchMetadata(asset);
      if (!metadata) continue;

      const publishedAt = new Date(release.published_at);
      seen.push(metadata.version);
      if (!oldestSeen || publishedAt < oldestSeen) oldestSeen = publishedAt;

      await this.prismaService.agent_releases.upsert({
        where: { release_version: metadata.version },
        create: {
          release_version: metadata.version,
          release_channel: release.prerelease ? 'beta' : 'stable',
          release_protocol: metadata.protocol,
          release_image: metadata.image,
          release_notes: release.body,
          release_published_at: publishedAt,
          release_blocked: metadata.blocked,
        },
        update: {
          release_channel: release.prerelease ? 'beta' : 'stable',
          release_protocol: metadata.protocol,
          release_image: metadata.image,
          release_notes: release.body,
          release_published_at: publishedAt,
          release_blocked: metadata.blocked,
          release_yanked_at: null,                          // 되살아났다면 회수 표시를 푼다.
          // release_manual_block은 일부러 빼 둔다. 운영자가 건 차단은 동기화로 풀리면 안 된다.
        },
      });
    }

    await this.markYanked(seen, oldestSeen);
    this.lastSyncedAt = Date.now();
    log(`[Release Catalog] Synced ${seen.length} releases from ${this.repo}`, 200, 'INFO');
  }

  /**
   * 응답에 없는데 캐시에 있는 버전은 GitHub에서 삭제된 것이다.
   * 행을 지우지 않고 표시만 한다. 이미 그 버전을 돌리는 Agent가 있을 수 있기 때문이다.
   *
   * 단 첫 페이지만 조회하므로, 이번에 본 것보다 오래된 릴리즈는 판단 대상에서 뺀다.
   * 그러지 않으면 릴리즈가 100개를 넘는 순간 과거 전체가 회수된 것으로 오인된다.
   */
  private async markYanked(seen: string[], oldestSeen: Date | null) {
    if (!oldestSeen) return;
    await this.prismaService.agent_releases.updateMany({
      where: {
        release_version: { notIn: seen },
        release_published_at: { gte: oldestSeen },
        release_yanked_at: null,
      },
      data: { release_yanked_at: new Date() },
    });
  }

  private async fetchMetadata(asset: GithubAsset): Promise<ReleaseMetadata | null> {
    try {
      const response = await fetch(asset.url, {
        headers: { ...this.headers(), Accept: 'application/octet-stream' },
      });
      if (!response.ok) return null;

      const parsed = (await response.json()) as Partial<ReleaseMetadata>;
      if (!parsed.version || typeof parsed.protocol !== 'number' || !parsed.image) return null;
      return {
        version: parsed.version,
        protocol: parsed.protocol,
        image: parsed.image,
        // 빈 문자열은 "막지 않음"으로 읽는다. 이유 없는 차단은 사용자에게 아무것도 알려주지 못한다.
        blocked: typeof parsed.blocked === 'string' && parsed.blocked.trim() ? parsed.blocked.trim() : null,
      };
    } catch (error) {
      log(`[Release Catalog] Failed to read ${asset.name}: ${String(error)}`, 500, 'ERROR');
      return null;
    }
  }

  /** Console에 보여줄 목록. 지원 범위를 벗어난 버전은 이유와 함께 내려보낸다. */
  async listReleases(includeBeta = false) {
    await this.ensureFresh();

    const rows = await this.prismaService.agent_releases.findMany({
      where: includeBeta ? {} : { release_channel: 'stable' },
    });
    // 발행일이 아니라 버전으로 정렬한다. 구버전 라인 핫픽스가 '최신'이 되면 안 된다.
    rows.sort((a, b) => compareSemver(b.release_version, a.release_version));

    return rows.map((row) => {
      // installable을 따로 계산하면 assertInstallable과 어긋나, 목록에서는 고를 수 있는데
      // 누르면 거부되는 버전이 생긴다. 사유 하나에서 둘 다 끌어낸다.
      const reason = this.blockedReason(row);
      return {
        version: row.release_version,
        channel: row.release_channel,
        protocol: row.release_protocol,
        notes: row.release_notes,
        publishedAt: row.release_published_at,
        yanked: row.release_yanked_at !== null,
        installable: reason === null,
        blockedReason: reason,
        // 해제할 수 있는 차단인지. 회수나 프로토콜 때문에 막힌 것은 운영자가 풀 수 없으므로
        // 이 값이 false면 Console도 해제 버튼을 내주지 않는다.
        manuallyBlocked: row.release_manual_block !== null,
      };
    });
  }

  /**
   * 현재 버전에서 올라갈 수 있는 릴리즈. 없으면 null.
   *
   * 판정을 Hub에 두는 이유는 카탈로그 전체와 프로토콜 지원 범위가 여기 있기 때문이다.
   * 클라이언트에 같은 로직을 두면 최종 관문인 assertInstallable()과 어긋날 수 있다.
   */
  async findUpgradeFor(currentVersion: string | null) {
    const releases = await this.listReleases();
    const latest = releases.find((release) => release.installable);
    if (!latest) return null;

    // 버전을 보고하지 않는 Agent(0.5.0 미만)는 무조건 업데이트 대상이다.
    if (!currentVersion) return latest;

    // '다르다'가 아니라 '높다'로 판정한다. 로컬 빌드처럼 카탈로그보다 앞선 Agent에게
    // 다운그레이드를 권하지 않기 위해서다.
    return compareSemver(latest.version, currentVersion) > 0 ? latest : null;
  }

  /** 업데이트를 실제로 지시하기 전의 최종 관문. */
  async assertInstallable(version: string) {
    await this.ensureFresh();

    const release = await this.prismaService.agent_releases.findUnique({
      where: { release_version: version },
    });
    if (!release) {
      throw new ServiceUnavailableException(`Unknown agent release: ${version}`);
    }
    const reason = this.blockedReason(release);
    if (reason) throw new ServiceUnavailableException(reason);

    return release;
  }

  /**
   * 운영자가 특정 버전의 설치를 막는다. 이유는 그대로 사용자에게 보이므로 무엇이 문제인지 적는다.
   *
   * 릴리즈를 삭제하는 것과 다르다. 목록과 패치노트는 그대로 남고 설치만 막히므로,
   * 이미 그 버전을 돌리는 Agent의 사용자도 자기 버전에 무슨 일이 있는지 볼 수 있다.
   */
  async blockRelease(version: string, reason: string) {
    const release = await this.prismaService.agent_releases.findUnique({
      where: { release_version: version },
    });
    if (!release) throw new NotFoundException(`Unknown agent release: ${version}`);

    await this.prismaService.agent_releases.update({
      where: { release_version: version },
      data: { release_manual_block: reason },
    });
    log(`[Release Catalog] Blocked ${version}: ${reason}`, 200, 'INFO');
  }

  /**
   * 이미 그 버전을 돌리고 있는 Agent에게 알릴 사유. 막을 이유가 없으면 null.
   *
   * 카탈로그에 없는 버전(로컬 빌드나 목록에서 밀려난 옛 버전)은 판단할 근거가 없으므로 null이다.
   * 여기서 "알 수 없음"을 경고로 바꾸면 정상적인 구버전 사용자에게까지 겁을 준다.
   */
  async blockedReasonForVersion(version: string | null): Promise<string | null> {
    if (!version) return null;

    const release = await this.prismaService.agent_releases.findUnique({
      where: { release_version: version },
    });
    if (!release) return null;

    return this.blockedReason(release);
  }

  /** 운영자 차단만 푼다. 회수나 프로토콜 때문에 막힌 것은 그대로 남는다. */
  async unblockRelease(version: string) {
    const release = await this.prismaService.agent_releases.findUnique({
      where: { release_version: version },
    });
    if (!release) throw new NotFoundException(`Unknown agent release: ${version}`);

    await this.prismaService.agent_releases.update({
      where: { release_version: version },
      data: { release_manual_block: null },
    });
    log(`[Release Catalog] Unblocked ${version}`, 200, 'INFO');
  }

  /**
   * 설치할 수 없는 이유. 없으면 null.
   *
   * 운영자 차단을 가장 먼저 본다. 사고 대응으로 건 차단이 다른 사유에 가려지면
   * 사용자에게 엉뚱한 설명이 나가고, 무엇보다 왜 막혔는지 운영자가 추적하기 어려워진다.
   */
  private blockedReason(release: {
    release_protocol: number;
    release_yanked_at: Date | null;
    release_blocked: string | null;
    release_manual_block: string | null;
  }): string | null {
    if (release.release_manual_block) return release.release_manual_block;
    if (release.release_blocked) return release.release_blocked;
    if (release.release_yanked_at) return '이 버전은 회수되었습니다.';
    if (release.release_protocol < SUPPORTED_PROTOCOL.min) {
      return `이 버전의 프로토콜(v${release.release_protocol})은 더 이상 지원되지 않습니다.`;
    }
    if (release.release_protocol > SUPPORTED_PROTOCOL.current) {
      return `이 버전은 현재 동작중인 Hub보다 최신 프로토콜(v${release.release_protocol})을 요구합니다.`;
    }
    return null;
  }
}
