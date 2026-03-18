import { IsOptional, IsString } from "class-validator";

export class CreateWorkspace {
  @IsOptional()
  @IsString()
  workspaceName: string | undefined;
}