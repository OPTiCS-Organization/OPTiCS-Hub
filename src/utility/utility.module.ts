import { Module } from "@nestjs/common";
import { CloudflareDnsUtility } from "./cloudflare.util";
import { ConfigModule } from "@nestjs/config";

@Module({
  providers: [CloudflareDnsUtility],
  imports: [ConfigModule],
  exports: [CloudflareDnsUtility],
})
export class UtilityModule { };