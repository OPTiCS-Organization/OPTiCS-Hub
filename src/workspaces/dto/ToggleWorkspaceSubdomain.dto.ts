import { IsBoolean } from "class-validator";

export class ToggleWorkspaceSubdomain {
  @IsBoolean()
  active: boolean;
}
