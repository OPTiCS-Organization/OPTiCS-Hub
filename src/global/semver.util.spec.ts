import { compareSemver } from './semver.util';
import { supportsRemoteUpdate } from './agent-capability';

describe('compareSemver', () => {
  const gt = (a: string, b: string) => expect(compareSemver(a, b)).toBeGreaterThan(0);
  const eq = (a: string, b: string) => expect(compareSemver(a, b)).toBe(0);

  it('major/minor/patch를 수치로 비교한다', () => {
    gt('0.6.0', '0.5.9');
    gt('0.5.10', '0.5.9');          // 문자열 비교였다면 뒤집힌다
    gt('1.0.0', '0.99.99');
    eq('0.6.0', '0.6.0');
  });

  it('프리릴리즈는 정식 릴리즈보다 낮다', () => {
    gt('0.6.0', '0.6.0-rc.1');
    gt('0.6.0-rc.2', '0.6.0-rc.1');
    gt('0.6.0-rc.10', '0.6.0-rc.9');
    gt('0.6.0-beta', '0.6.0-alpha');
  });

  it('빌드 메타데이터는 우선순위에 영향이 없다', () => {
    eq('0.6.0+build.1', '0.6.0');
  });

  it('파싱할 수 없는 버전은 정상 버전보다 낮다', () => {
    gt('0.0.1', 'not-a-version');
    gt('0.0.1', 'latest');
  });

  it('구버전 라인 핫픽스가 상위 버전을 앞지르지 않는다', () => {
    // 발행일 기준이었다면 나중에 나온 0.5.4가 최신이 되어 다운그레이드를 권했다.
    gt('0.6.0', '0.5.4');
  });
});

describe('supportsRemoteUpdate', () => {
  it('0.6.0 미만과 버전 미보고 Agent는 원격 업데이트 대상이 아니다', () => {
    expect(supportsRemoteUpdate(null)).toBe(false);
    expect(supportsRemoteUpdate('0.5.3')).toBe(false);
    expect(supportsRemoteUpdate('0.6.0-rc.1')).toBe(false);   // 프리릴리즈는 0.6.0보다 낮다
    expect(supportsRemoteUpdate('0.6.0')).toBe(true);
    expect(supportsRemoteUpdate('1.0.0')).toBe(true);
  });
});
