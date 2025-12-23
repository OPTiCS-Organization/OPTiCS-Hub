import { IsOptional, IsString } from "class-validator";

export class CreateContainer {
  @IsOptional()
  @IsString()
  containerName: string;
}