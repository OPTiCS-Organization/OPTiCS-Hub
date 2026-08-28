/*
 * Refresh Token 회전의 경계 동작을 고정합니다.
 *
 * Refresh Token은 1회용이라 쓰는 즉시 만료 처리됩니다. 그런데 액세스 토큰이 만료된
 * 순간 페이지가 요청을 여러 개 동시에 던지면 그 요청들이 각자 갱신을 시도하고,
 * 먼저 도착한 하나가 토큰을 만료시키는 순간 나머지는 "없는 토큰"이 되어 로그아웃됩니다.
 * 앱 부팅 시 /v1/auth/me 와 /v1/workspace 가 나란히 나가므로 실제로 재현됐습니다.
 *
 * Prisma는 인메모리 대역으로 대신합니다. 여기서 확인하려는 것은 DB 동작이 아니라
 * "어떤 조건의 토큰을 받아주고 어떤 것을 거절하는가"라는 판단 규칙입니다.
 */
import { JwtUtil } from './jwt.util';

const USER_INDEX = 7;
const TOKEN = 'refresh-token-value';

type Row = {
  token_index: number;
  token_owner: number;
  token: string;
  token_expired_at: Date | null;
};

/** refresh()가 쓰는 만큼만 흉내 낸 refresh_token 테이블. */
function fakePrisma(rows: Row[]) {
  const matches = (row: Row, where: any) => {
    if (where.token_owner !== undefined && row.token_owner !== where.token_owner) return false;
    if (where.token !== undefined && row.token !== where.token) return false;

    const expired = where.token_expired_at;
    if (expired === null) return row.token_expired_at === null;
    if (expired?.gte) return row.token_expired_at !== null && row.token_expired_at >= expired.gte;
    return true;
  };

  let nextIndex = rows.length + 1;

  return {
    rows,
    refresh_token: {
      findFirst: ({ where }: any) => Promise.resolve(rows.find(row => matches(row, where)) ?? null),
      update: ({ where, data }: any) => {
        const row = rows.find(candidate => candidate.token_index === where.token_index)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      },
      // signLoginTokens가 새로 발급한 Refresh Token을 저장한다.
      create: ({ data }: any) => {
        const row: Row = {
          token_index: nextIndex++,
          token_owner: data.token_owner,
          token: data.token,
          token_expired_at: null,
        };
        rows.push(row);
        return Promise.resolve(row);
      },
    },
  };
}

function makeUtil(rows: Row[], decoded: { userIndex: number } | null = { userIndex: USER_INDEX }) {
  const prisma = fakePrisma(rows);
  const jwtService = {
    decode: () => decoded,
    signAsync: (payload: any) => Promise.resolve(`signed:${payload.purpose}`),
  };
  const configService = { get: () => '5m', getOrThrow: () => '5m' };

  const util = new JwtUtil(jwtService as any, configService as any, prisma as any);
  return { util, prisma };
}

function activeRow(): Row {
  return { token_index: 1, token_owner: USER_INDEX, token: TOKEN, token_expired_at: null };
}

describe('JwtUtil.refresh', () => {
  it('살아 있는 토큰이면 새 쌍을 발급한다', async () => {
    const { util } = makeUtil([activeRow()]);

    const result = await util.refresh(TOKEN);

    expect(result.accessToken).not.toBeNull();
    expect(result.refreshToken).not.toBeNull();
  });

  it('쓰고 나면 그 토큰을 만료 처리한다', async () => {
    const { util, prisma } = makeUtil([activeRow()]);

    await util.refresh(TOKEN);

    expect(prisma.rows[0].token_expired_at).toBeInstanceOf(Date);
  });

  /**
   * 동시 요청 경쟁의 핵심 장면.
   *
   * 먼저 도착한 요청이 토큰을 회전시킨 **뒤에** 두 번째가 같은 토큰을 들고 온다.
   * 유예 창이 없으면 여기서 두 번째가 로그아웃당한다.
   *
   * `Promise.all`로 진짜 동시 호출을 흉내 내는 방식은 쓰지 않는다. 인메모리 대역에는
   * DB 같은 잠금이 없어 셋 다 쓰기 전에 읽어버리고, 그러면 유예 창을 꺼도 통과해
   * 아무것도 지키지 못하는 테스트가 된다.
   */
  it('방금 회전된 토큰을 다시 제시해도 받아준다', async () => {
    const { util } = makeUtil([activeRow()]);

    const first = await util.refresh(TOKEN);
    const second = await util.refresh(TOKEN);

    expect(first.accessToken).not.toBeNull();
    expect(second.accessToken).not.toBeNull();
  });

  // 유예 창이 무한하면 회전이 의미를 잃는다.
  it('유예 창을 벗어나 만료된 토큰은 거절한다', async () => {
    const longAgo = new Date(Date.now() - 60_000);
    const { util } = makeUtil([{ ...activeRow(), token_expired_at: longAgo }]);

    const result = await util.refresh(TOKEN);

    expect(result).toEqual({ accessToken: null, refreshToken: null });
  });

  it('저장된 적 없는 토큰은 거절한다', async () => {
    const { util } = makeUtil([]);

    const result = await util.refresh(TOKEN);

    expect(result).toEqual({ accessToken: null, refreshToken: null });
  });

  /*
   * 아래 둘은 예전에 TypeError로 터지던 자리다. refresh()는 예외 필터
   * (TokenRefreshFilter) 안에서 호출되므로, 여기서 던지면 401 대신 500이 나가고
   * 클라이언트는 로그인 화면으로도 가지 못한다.
   */
  it('토큰이 없으면 던지지 않고 거절한다', async () => {
    const { util } = makeUtil([activeRow()]);

    await expect(util.refresh(undefined)).resolves.toEqual({ accessToken: null, refreshToken: null });
  });

  it('해독할 수 없는 토큰이면 던지지 않고 거절한다', async () => {
    const { util } = makeUtil([activeRow()], null);

    await expect(util.refresh('garbage')).resolves.toEqual({ accessToken: null, refreshToken: null });
  });
});
