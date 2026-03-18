import { IsNotEmpty, IsString } from "class-validator";

export class ConnectWorkspace {
  @IsString()
  @IsNotEmpty()
  targetAgentCode: string;
}