import { Module } from "@nestjs/common";
import { CloudflareDnsUtility } from "./cloudflare.util";

@Module({
  providers: [CloudflareDnsUtility],
  exports: [CloudflareDnsUtility],
})
export class UtilityModule { };
