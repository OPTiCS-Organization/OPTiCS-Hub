/*
 * isWorkspaceHostname이 플랫폼 자체 호스트(console.optics.run 등)를 워크스페이스 트래픽으로
 * 잘못 집계하지 않는지 확인하는 계약 테스트입니다.
 *
 * `console.optics.run`은 라벨 개수만 보면 워크스페이스 루트 도메인(`<workspace>.optics.run`)과
 * 구별되지 않으므로, 예약어 필터가 정확히 걸러내는지가 이 함수의 핵심입니다.
 */
import { backfillDates, isWorkspaceHostname, trailingDateList } from './traffic-sync.service';

describe('isWorkspaceHostname', () => {
  it('워크스페이스 루트 도메인(3라벨)을 워크스페이스 트래픽으로 인식한다', () => {
    expect(isWorkspaceHostname('my-workspace.optics.run')).toBe(true);
  });

  it('서비스 서브도메인이 붙은 도메인(4라벨)을 워크스페이스 트래픽으로 인식한다', () => {
    expect(isWorkspaceHostname('api.my-workspace.optics.run')).toBe(true);
  });

  it('예약어를 쓰는 플랫폼 자체 호스트를 걸러낸다', () => {
    expect(isWorkspaceHostname('console.optics.run')).toBe(false);
    expect(isWorkspaceHostname('api.optics.run')).toBe(false);
    expect(isWorkspaceHostname('docs.optics.run')).toBe(false);
    expect(isWorkspaceHostname('admin.optics.run')).toBe(false);
    expect(isWorkspaceHostname('tunnel.optics.run')).toBe(false);
    expect(isWorkspaceHostname('proxy.optics.run')).toBe(false);
  });

  it('4라벨이어도 워크스페이스 라벨이 예약어면 걸러낸다', () => {
    expect(isWorkspaceHostname('api.console.optics.run')).toBe(false);
  });

  it('apex 도메인(2라벨, 랜딩 사이트)을 걸러낸다', () => {
    expect(isWorkspaceHostname('optics.run')).toBe(false);
  });

  it('optics.run 존이 아닌 호스트를 걸러낸다', () => {
    expect(isWorkspaceHostname('my-workspace.example.com')).toBe(false);
  });

  it('라벨이 5개 이상인 호스트를 걸러낸다', () => {
    expect(isWorkspaceHostname('a.b.my-workspace.optics.run')).toBe(false);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isWorkspaceHostname('My-Workspace.OPTICS.RUN')).toBe(true);
    expect(isWorkspaceHostname('CONSOLE.optics.run')).toBe(false);
  });
});

describe('backfillDates', () => {
  const DAY = 86400;
  /** 2026-09-03T02:11:53Z — 실제로 거절당했던 그 순간. */
  const NOW = Date.parse('2026-09-03T02:11:53Z');

  it('보존 창(1w1d)에 걸치는 가장 오래된 하루를 제외한다', () => {
    /*
     * 이 케이스가 이 테스트의 존재 이유다. 8일 보존인 존에서 8일을 그대로 세면
     * 2026-08-26T00:00:00Z 를 요청하게 되는데, 그건 NOW 기준 8일 2시간 11분 전이라
     * 창 밖이다. Cloudflare 는 이걸 quota 에러로 통째로 거절한다.
     */
    const dates = backfillDates(NOW, 8 * DAY, 40);

    expect(dates).not.toContain('2026-08-26');
    expect(dates[0]).toBe('2026-09-02');
    expect(dates[dates.length - 1]).toBe('2026-08-27');
    expect(dates).toHaveLength(7);
  });

  it('자정 직후에도 경계에 걸친 하루를 넣지 않는다', () => {
    /* 00:05 면 8일 전 자정이 창 안으로 5분 들어오지만, 안전 여유(15분) 안쪽이라 여전히 버린다. */
    const justAfterMidnight = Date.parse('2026-09-03T00:05:00Z');
    expect(backfillDates(justAfterMidnight, 8 * DAY, 40)).not.toContain('2026-08-26');
  });

  it('오늘은 포함하지 않는다 — 아직 집계가 끝나지 않은 하루다', () => {
    expect(backfillDates(NOW, 8 * DAY, 40)).not.toContain('2026-09-03');
  });

  it('maxDays 로 상한을 건다', () => {
    expect(backfillDates(NOW, 365 * DAY, 40)).toHaveLength(40);
  });

  it('보존 창이 하루도 못 채우면 빈 목록을 준다', () => {
    /* 어제 자정조차 창 밖이면 받아올 수 있는 완전한 하루가 없다. */
    expect(backfillDates(NOW, 1 * DAY, 40)).toEqual([]);
  });
});

describe('trailingDateList', () => {
  it('어제부터 거꾸로 센다', () => {
    expect(trailingDateList(Date.parse('2026-03-02T09:00:00Z'), 3))
      .toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
  });
});
