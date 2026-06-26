import { IsUUID, Length, Matches } from "class-validator";

export class RequestConnect {
  @Length(0, 63)
  @Matches(/^$|^@$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  serviceSubdomain: string;

  @Length(1, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  workspaceSubdomain: string;

  @IsUUID()
  token: string;
}
