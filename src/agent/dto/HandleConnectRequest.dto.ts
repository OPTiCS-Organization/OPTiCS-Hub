import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class HandleConnectRequest {
  @IsNotEmpty()
  @IsString()
  agentCode: string;

  @IsNotEmpty()
  @IsUUID()
  agentUuid: string;
}
