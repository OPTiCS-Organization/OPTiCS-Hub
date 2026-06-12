import { IsUUID, Length, Matches } from "class-validator";

export class RequestConnect {
  @Length(1, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  subdomain: string;

  @IsUUID()
  token: string;
}