import { IsNotEmpty, IsString } from "class-validator";

export class HandleConnectRequest {
  @IsNotEmpty()
  @IsString()
  agentCode: string;
}