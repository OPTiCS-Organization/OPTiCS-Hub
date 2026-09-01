import { IsBoolean, IsOptional, IsUUID, Length, Matches } from "class-validator";

export class RequestConnect {
  @Length(0, 63)
  @Matches(/^$|^@$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  serviceSubdomain: string;

  @Length(1, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  workspaceSubdomain: string;

  @IsUUID()
  token: string;

  /**
   * 게이트웨이가 프리커넥트 풀에서 소켓을 꺼내 쓰겠다는 뜻.
   *
   * 이때는 Agent가 이미 소켓을 열어 두었으므로 tunnel-connect 명령을 보내지 않고
   * 라우팅 정보만 돌려준다. 풀이 비어 있으면 게이트웨이가 이 값 없이 다시 요청한다.
   */
  @IsOptional()
  @IsBoolean()
  preferPooled?: boolean;
}
