import { IsOptional, Length, Matches } from "class-validator";

export class UpdateServiceSubdomain {
  @IsOptional()
  @Length(1, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  subdomain?: string | null;
}
