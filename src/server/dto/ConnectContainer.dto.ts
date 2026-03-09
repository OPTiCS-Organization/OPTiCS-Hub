import { IsNotEmpty, IsString } from "class-validator";

export class ConnectContainer {
  @IsString()
  @IsNotEmpty()
  targetAgentCode: string;
}