import { IsString } from "class-validator";

export class DeleteWorkspace {
  @IsString()
  confirmation: string;
}
