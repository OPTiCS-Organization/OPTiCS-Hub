import { IsNotEmpty, IsNumber } from "class-validator";

export class DeleteWorkspace {
  @IsNotEmpty()
  @IsNumber()
  workspaceIndex: number;
}