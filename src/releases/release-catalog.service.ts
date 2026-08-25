import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { isProtocolSupported, SUPPORTED_PROTOCOL } from 'src/global/protocol';
import { compareSemver } from 'src/global/semver.util';

/** 릴리즈 자산으로 발행되는 메타데이터. Agent 저장소의 릴리즈 워크플로가 만든다. */
type ReleaseMetadata = {
  version: string;
  protocol: number;
  image: string;
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
/** 읽기 요청이 이 시간보다 오래된 캐시를 만나면 먼저 동기화한다. */
const FRESHNESS_MS = 15 * 60 * 1000;
/** 동기화가 실패한 뒤 다시 시도하기까지의 최소 간격. GitHub 장애 때 매 요청마다 때리지 않기 위한 것이다. */
const RETRY_BACKOFF_MS = 60 * 1000;

/**
 * Agent 릴리즈 카탈로그.
 *
 * GitHub Releases를 캐시하되, release.json 자산이 붙은 릴리즈만 받아들인다.
 * 그 자산은 이미지 푸시가 성공한 뒤에만 발행되므로 자산의 존재가 곧 이미지 존재의 영수증이고,
 * 덕분에 '패치노트는 보이는데 docker pull하면 죽는 버전'이 카탈로그에 오를 수 없다.
 */
@Injectable()
export class ReleaseCatalogService {
  private lastSyncedAt = 0;
  private lastAttemptAt = 0;
  private syncing: Promise<void> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) { }

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

  private async runSync(): Promise<void> {
    const response = await fetch(
      `https://api.github.com/repos/${this.repo}/releases?per_page=100`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException(`GitHub releases fetch failed: ${response.status}`);
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
        },
        update: {
          release_channel: release.prerelease ? 'beta' : 'stable',
          release_protocol: metadata.protocol,
          release_image: metadata.image,
          release_notes: release.body,
          release_published_at: publishedAt,
          release_yanked_at: null,                          // 되살아났다면 회수 표시를 푼다.
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
      return { version: parsed.version, protocol: parsed.protocol, image: parsed.image };
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

    return rows.map((row) => ({
      version: row.release_version,
      channel: row.release_channel,
      protocol: row.release_protocol,
      notes: row.release_notes,
      publishedAt: row.release_published_at,
      yanked: row.release_yanked_at !== null,
      installable: row.release_yanked_at === null && isProtocolSupported(row.release_protocol),
      blockedReason: this.blockedReason(row.release_protocol, row.release_yanked_at),
    }));
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
    const reason = this.blockedReason(release.release_protocol, release.release_yanked_at);
    if (reason) throw new ServiceUnavailableException(reason);

    return release;
  }

  private blockedReason(protocol: number, yankedAt: Date | null): string | null {
    if (yankedAt) return '이 버전은 회수되었습니다.';
    if (protocol < SUPPORTED_PROTOCOL.min) {
      return `이 버전의 프로토콜(v${protocol})은 더 이상 지원되지 않습니다.`;
    }
    if (protocol > SUPPORTED_PROTOCOL.current) {
      return `이 버전은 Hub보다 최신 프로토콜(v${protocol})을 요구합니다. Hub를 먼저 업데이트해야 합니다.`;
    }
    return null;
  }
}
