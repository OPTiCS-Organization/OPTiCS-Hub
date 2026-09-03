import { Module } from "@nestjs/common";
import { CloudflareDnsUtility } from "./cloudflare.util";
import { CloudflareAnalyticsUtility } from "./cloudflare-analytics.util";

@Module({
  providers: [CloudflareDnsUtility, CloudflareAnalyticsUtility],
  exports: [CloudflareDnsUtility, CloudflareAnalyticsUtility],
})
export class UtilityModule { };
