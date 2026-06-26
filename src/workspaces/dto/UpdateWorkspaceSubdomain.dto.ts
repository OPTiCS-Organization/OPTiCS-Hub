import { IsNotIn, IsOptional, Length, Matches } from "class-validator";

const RESERVED_WORKSPACE_SUBDOMAINS = ['api', 'docs', 'console', 'admin', 'tunnel', 'proxy'];

export class UpdateWorkspaceSubdomain {
  @IsOptional()
  @Length(1, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
  @IsNotIn(RESERVED_WORKSPACE_SUBDOMAINS, { message: 'This workspace subdomain is reserved.' })
  subdomain?: string | null;
}
