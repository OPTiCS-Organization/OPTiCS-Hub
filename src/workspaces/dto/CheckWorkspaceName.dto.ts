import { IsNotEmpty, IsString } from "class-validator";

export class CheckWorkspaceName {
  @IsNotEmpty()
  @IsString()
  workspaceName: string;
}