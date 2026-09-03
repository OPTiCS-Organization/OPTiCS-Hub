import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import log from 'spectra-log';
import { PrismaService } from 'src/prisma.service';
import { TRAFFIC_WINDOW_DAYS } from 'src/traffic/traffic-sync.service';

/** /v1/stats/public이 캐시하는 응답 하나 분량의 모양. */
type PublicStats = {
  version: string | null;
  runningContainers: number;
  activeWorkspaceDomains: number;
  installedAgents: number;
  trafficBytes: string;
  trafficWindowDays: number;
  trafficAvailable: boolean;
  generatedAt: string;
};

/**
 * 캐시 수명.
 *
 * 이 엔드포인트는 인증도 쿠키도 없는 공개 API라, 캐시가 없으면 마케팅 사이트의 폴링이 그대로
 * "누구나 두드릴 수 있는 DB 부하 유발기"가 된다. 30초로 두면 폴링 주기가 아무리 짧아도
 * 실제 DB 조회는 최대 초당 1/30 회로 눌린다.
 */
const CACHE_TTL_MS = 30_000;

/**
 * 플랫폼 버전. package.json 의 version 을 그대로 쓴다.
 *
 * 랜딩 페이지가 여러 곳(Hero 배지 · 현재 상태 · Closing · Footer · 비교 표)에서 이 값을
 * 문자열로 박아 두고 있었다. 릴리즈할 때마다 다섯 군데를 손으로 고쳐야 했고, 하나라도
 * 빠뜨리면 페이지가 서로 다른 버전을 주장하게 된다. 진실의 출처를 여기 하나로 옮긴다.
 *
 * 이건 Hub 의 버전이다. Agent 는 자기 릴리즈 채널(agent_releases)을 따로 갖고 있어
 * 버전이 다를 수 있다.
 *
 * 경로를 __dirname 기준으로 잡지 않는다. 소스에서는 `../../package.json` 이 맞지만 빌드하면
 * 그 파일은 dist/src/stats/ 로 내려가 같은 상대경로가 dist/package.json 을 가리키고, 거기엔
 * package.json 이 없어서 부팅이 통째로 실패한다(실제로 한 번 그렇게 죽였다). 대신 cwd 를
 * 기준으로 읽는다 — ConfigModule 이 .env 를 찾는 기준과 같아서 이미 프로젝트 루트에서
 * 실행된다는 전제가 서 있다.
 *
 * 그래도 실패할 수 있으므로(다른 cwd 에서 기동 등) 예외를 삼키고 null 을 둔다. 버전은
 * 없으면 화면에서 그 문장만 빠지는 값이지, 서버를 못 뜨게 할 값이 아니다.
 */
function readPlatformVersion(): string | null {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim() !== '' ? parsed.version : null;
  } catch (error) {
    log(`[Stats] Could not read platform version: ${String(error)}`, 500, 'ERROR');
    return null;
  }
}

const PLATFORM_VERSION: string | null = readPlatformVersion();

@Injectable()
export class StatsService {
  private cache: { data: PublicStats; expiresAt: number } | null = null;
  /** 캐시가 만료된 순간 동시에 여러 요청이 들어와도 DB 왕복은 한 번만 돌게 하는 dedupe. */
  private pending: Promise<PublicStats> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
  ) { }

  async getPublicStats(): Promise<PublicStats> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.data;
    if (this.pending) return this.pending;

    this.pending = this.computeStats()
      .then((data) => {
        this.cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
        return data;
      })
      .finally(() => { this.pending = null; });

    return this.pending;
  }

  private async computeStats(): Promise<PublicStats> {
    try {
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);
      windowStart.setUTCDate(windowStart.getUTCDate() - TRAFFIC_WINDOW_DAYS);

      const [runningContainers, activeWorkspaceDomains, installedAgents, trafficRows] = await Promise.all([
        this.prismaService.service_components.count({
          where: {
            component_status: 'running',
            component_deleted_at: null,
            service: { service_deleted_at: null },
          },
        }),
        this.prismaService.workspaces.count({
          where: { workspace_subdomain_active: true, workspace_deleted_at: null },
        }),
        // 누적 지표(installedAgents)라 agent_deleted_at으로 거르지 않는다. "지금까지 설치된
        // 대수"가 목적이지 "현재 살아있는 대수"가 아니다.
        this.prismaService.agents.count({
          where: { agent_version: { not: null } },
        }),
        this.prismaService.traffic_daily.findMany({
          where: { traffic_date: { gte: windowStart } },
          select: { traffic_bytes: true },
        }),
      ]);

      const trafficBytes = trafficRows.reduce((sum, row) => sum + row.traffic_bytes, 0n);

      return {
        version: PLATFORM_VERSION,
        runningContainers,
        activeWorkspaceDomains,
        installedAgents,
        trafficBytes: trafficBytes.toString(),
        // 실제로 동기화가 채운 날짜 수를 보고한다. 잡이 아직 7일치밖에 못 채웠는데 30을
        // 내려보내면 "최근 30일" 문구가 랜딩 페이지에서 거짓말이 된다.
        trafficWindowDays: Math.min(trafficRows.length, TRAFFIC_WINDOW_DAYS),
        trafficAvailable: trafficRows.length > 0,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      // DB 내부 사정을 공개 API 응답으로 흘려보내지 않는다. 원인은 로그로만 남긴다.
      log(`[Stats] Failed to compute public stats: ${String(error)}`, 500, 'ERROR');
      throw new ServiceUnavailableException('Failed to compute platform stats.');
    }
  }
}
