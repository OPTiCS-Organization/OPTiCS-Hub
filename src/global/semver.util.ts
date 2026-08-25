/**
 * SemVer 2.0 우선순위 비교.
 *
 * 릴리즈 순서를 발행일로 판단하면, 구버전 라인에 핫픽스를 내는 순간 그것이 '최신'이 되어
 * 상위 버전 사용자에게 다운그레이드를 권하게 된다. 순서는 버전 자체에서 나와야 한다.
 *
 * 빌드 메타데이터(+...)는 우선순위에 영향을 주지 않으므로 무시한다.
 */

type Parsed = {
  major: number;
  minor: number;
  patch: number;
  /** 프리릴리즈 식별자. 비어 있으면 정식 릴리즈다. */
  pre: string[];
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(version: string): Parsed | null {
  const matched = SEMVER.exec(version.trim());
  if (!matched) return null;
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    pre: matched[4] ? matched[4].split('.') : [],
  };
}

/** 숫자 식별자는 수치로, 그 외는 사전순으로 비교한다. 숫자는 항상 문자보다 낮다. */
function comparePreIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePre(a: string[], b: string[]): number {
  // 프리릴리즈가 있는 쪽이 낮다. 0.6.0-rc.1 < 0.6.0
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i >= a.length) return -1;             // 식별자가 적은 쪽이 낮다
    if (i >= b.length) return 1;
    const result = comparePreIdentifier(a[i], b[i]);
    if (result !== 0) return result;
  }
  return 0;
}

/**
 * a > b 면 양수, a < b 면 음수, 같으면 0.
 * 파싱할 수 없는 버전은 어떤 정상 버전보다도 낮게 취급한다.
 * 잘못 표기된 릴리즈가 '최신'으로 올라와 전체 사용자에게 권해지는 것을 막기 위해서다.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePre(left.pre, right.pre);
}
