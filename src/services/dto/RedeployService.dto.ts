import { IsArray, IsEnum, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { DeployPreset } from '@prisma/client';

export class ServicePortMapping {
  @IsNumber()
  hostPort: number;

  @IsNumber()
  containerPort: number;
}

export class SourceRepository {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  rootDirectory?: string | null;
}

export class RedeployService {
  @IsOptional()
  @IsString()
  serviceName?: string;

  @IsOptional()
  @IsNumber()
  servicePort?: number;

  @IsOptional()
  @IsNumber()
  serviceContainerPort?: number;

  @IsOptional()
  @IsNumber()
  serviceHostPort?: number;

  @IsOptional()
  @IsArray()
  servicePortMappings?: ServicePortMapping[];

  @IsOptional()
  serviceSourceUrl?: string | string[] | SourceRepository[];

  @IsOptional()
  @IsString()
  serviceRootDirectory?: string;

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
