import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TrafficBlockMode } from '@prisma/client';

export class BlockServiceTraffic {
  /**
   * 차단된 주소로 온 요청에 무엇을 보여줄지.
   *
   * 기본값을 notice로 두는 이유는, 숨김이 정상 이용자에게는 '주소를 잘못 쳤나'로만
   * 보이기 때문이다. 존재를 감추는 쪽은 그러기로 정했을 때만 골라야 한다.
   */
  @IsOptional()
  @IsIn(['notice', 'hidden'])
  mode?: TrafficBlockMode;

  /** 운영 기록용 메모. 공개 오류 페이지에는 나가지 않는다. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
