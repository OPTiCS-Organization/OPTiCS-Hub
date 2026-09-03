import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** 호스트네임별 하루치 바이트 합계. Cloudflare가 dimensions.clientRequestHTTPHost로 이미 묶어서 준다. */
export type HostnameByteBreakdown = { hostname: string; bytes: bigint }[];

type GraphqlErrorEnvelope = { errors?: { message: string }[] };

@Injectable()
export class CloudflareAnalyticsUtility {
  /**
   * Analytics 전용 토큰. DNS용 `CLOUDFLARE_API_KEY`와 **다른 변수**다.
   *
   * 처음에는 DNS 토큰을 재사용하게 만들었는데, 그러면 그 하나에 DNS Edit 과
   * Analytics:Read 가 함께 붙는다. 레코드를 만들고 지우는 권한과 통계를 읽는 권한은
   * 사고 시 피해 범위가 전혀 다르므로 토큰을 나눈다 — 통계 조회는 읽기 전용이면
   * 충분하고, 유출되어도 DNS 를 건드릴 수 없어야 한다.
   */
  private readonly CLOUDFLARE_ANALYTIC_KEY: string | null;
  private readonly CLOUDFLARE_ZONE_ID: string;

  constructor(
    private readonly configService: ConfigService,
  ) {
    /*
      DNS 키와 달리 getOrThrow 를 쓰지 않는다. 이 토큰이 하는 일은 랜딩 페이지의 트래픽
      숫자 하나뿐이라, 없다고 Hub 전체가 부팅을 못 하면 개발·CI 환경까지 이 장식 하나에
      묶인다. 없으면 동기화를 아예 걸지 않고 /v1/stats/public 이 trafficAvailable: false 로
      내려가는 것이 이미 설계된 실패 경로다(README 의 설명과 같은 동작).
      ZONE_ID 는 DNS 쪽이 어차피 필수로 요구하므로 여기서도 그대로 강제한다.
    */
    this.CLOUDFLARE_ANALYTIC_KEY = configService.get<string>('CLOUDFLARE_ANALYTIC_KEY')?.trim() || null;
    this.CLOUDFLARE_ZONE_ID = configService.getOrThrow<string>('CLOUDFLARE_ZONE_ID');
  }

  /** 토큰이 설정돼 있는지. 동기화 스케줄러가 아예 돌지 말지를 이걸로 정한다. */
  get isConfigured(): boolean {
    return this.CLOUDFLARE_ANALYTIC_KEY !== null;
  }

  private logCloudflareFailure(action: string, errors: unknown) {
    Logger.error({ action, errors }, CloudflareAnalyticsUtility.name);
  }

  /**
   * GraphQL Analytics 엔드포인트에 쿼리를 실행한다.
   *
   * REST와 달리 4xx/5xx가 아니라 200 + `errors` 배열로 실패를 알리는 경우가 흔해서,
   * DNS 유틸(cloudflare.util.ts)처럼 `success` 필드를 보는 대신 `errors`를 직접 확인한다.
   */
  private async query<T>(query: string, variables: Record<string, unknown>, action: string): Promise<T> {
    /* 호출부(TrafficSyncService)가 isConfigured 로 이미 막지만, 다른 경로가 생겼을 때를 위해 남긴다. */
    if (this.CLOUDFLARE_ANALYTIC_KEY === null) {
      throw new Error(`Cloudflare analytics token is not configured (${action}).`);
    }

    const response = await axios.post<{ data?: T } & GraphqlErrorEnvelope>(
      GRAPHQL_ENDPOINT,
      { query, variables },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.CLOUDFLARE_ANALYTIC_KEY}`,
        },
        validateStatus: () => true,
      },
    );

    if (response.data.errors?.length || !response.data.data) {
      this.logCloudflareFailure(action, response.data.errors ?? 'empty data');
      throw new Error(`Cloudflare GraphQL query failed (${action}): ${JSON.stringify(response.data.errors ?? [])}`);
    }

    return response.data.data;
  }

  /**
   * 이 존이 httpRequestsAdaptiveGroups를 몇 초 전까지 보관하는지 물어본다.
   *
   * 보존 기간은 플랜마다 달라 하드코딩할 수 없다(Cloudflare 문서: settings 노드의
   * notOlderThan으로 존별·데이터셋별 실제 값을 조회하라고 안내한다). 실패하면 null을 돌려주고,
   * 호출부가 보수적인 기본값으로 대신한다 — 정확한 값을 모른다고 동기화 자체를 막을 이유는 없다.
   */
  async getHttpRequestsRetentionSeconds(): Promise<number | null> {
    type Response = {
      viewer: {
        zones: { settings: { httpRequestsAdaptiveGroups: { notOlderThan: number } | null } }[];
      };
    };

    try {
      const data = await this.query<Response>(
        `query RetentionSettings($zoneTag: string) {
          viewer {
            zones(filter: { zoneTag: $zoneTag }) {
              settings { httpRequestsAdaptiveGroups { notOlderThan } }
            }
          }
        }`,
        { zoneTag: this.CLOUDFLARE_ZONE_ID },
        'getHttpRequestsRetentionSeconds',
      );
      return data.viewer.zones[0]?.settings?.httpRequestsAdaptiveGroups?.notOlderThan ?? null;
    } catch (error) {
      this.logCloudflareFailure('getHttpRequestsRetentionSeconds', String(error));
      return null;
    }
  }

  /**
   * 지정한 UTC 날짜(00:00~다음날 00:00) 동안 이 존으로 들어온 요청을 호스트네임별로 합산해 온다.
   *
   * 워크스페이스 호스트만 걸러내는 필터를 여기 쿼리에 넣지 않는다. "무엇이 워크스페이스
   * 트래픽인가"는 예약어·라벨 개수 같은 Hub 쪽 규칙(TrafficSyncService.isWorkspaceHostname)이라,
   * 존 전체를 호스트별로만 쪼개 돌려주고 판정은 호출부가 한다.
   *
   * limit은 하루에 관측되는 서로 다른 호스트 수보다 넉넉히 크게 잡는다. 이보다 많은 서로 다른
   * 호스트가 하루에 잡히면 초과분은 누락되는데, 지금 규모의 워크스페이스 수에서는 무리 없는 가정이다.
   *
   * filter 객체를 GraphQL 변수로 선언하지 않고 쿼리 문자열에 직접 박아 넣은 이유: 정확한 입력
   * 타입 이름(예: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject)을 스키마 없이 확정할 수
   * 없었다. 여기 들어가는 값은 전부 이 함수가 계산한 ISO 날짜 문자열이라 사용자 입력이 아니므로
   * 인터폴레이션이 안전하다.
   */
  async getDailyBytesByHostname(startIso: string, endIsoExclusive: string): Promise<HostnameByteBreakdown> {
    type Row = { sum: { edgeResponseBytes: number }; dimensions: { clientRequestHTTPHost: string } };
    type Response = { viewer: { zones: { httpRequestsAdaptiveGroups: Row[] }[] } };

    const data = await this.query<Response>(
      `query TrafficByHostname($zoneTag: string) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: 2500,
              filter: { datetime_geq: "${startIso}", datetime_lt: "${endIsoExclusive}" }
            ) {
              sum { edgeResponseBytes }
              dimensions { clientRequestHTTPHost }
            }
          }
        }
      }`,
      { zoneTag: this.CLOUDFLARE_ZONE_ID },
      'getDailyBytesByHostname',
    );

    const rows = data.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? [];
    return rows.map((row) => ({
      hostname: row.dimensions.clientRequestHTTPHost,
      // edgeResponseBytes는 Cloudflare 응답에서 부동소수점으로 온다. 반올림 후 BigInt로 바꿔
      // 그 이후로는 정밀도를 잃지 않게 한다.
      bytes: BigInt(Math.round(row.sum.edgeResponseBytes)),
    }));
  }
}
