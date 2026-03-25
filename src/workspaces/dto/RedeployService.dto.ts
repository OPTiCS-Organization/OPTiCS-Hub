import { IsArray, IsEnum, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { DeployPreset } from '@prisma/client';

export class RedeployService {
  @IsOptional()
  @IsString()
  serviceName?: string;

  @IsOptional()
  @IsNumber()
  servicePort?: number;

  @IsOptional()
  serviceSourceUrl?: string | string[];

  @IsOptional()
  @IsString()
  serviceVersion?: string;

  @IsOptional()
  @IsEnum(DeployPreset)
  serviceDeployPreset?: DeployPreset;

  @IsOptional()
  @IsObject()
  env?: Record<string, string>;
}
