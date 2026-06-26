import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
  CloudflareResponse,
  CreateDnsRecordResponse,
  UpdateDnsRecordResponse,
  DeleteDnsRecordResponse,
} from "./types/cloudflare.type";

@Injectable()
export class CloudflareDnsUtility {
  private readonly CLOUDFLARE_API_KEY: string;
  private readonly CLOUDFLARE_ZONE_ID: string;
  private readonly OPTICS_HUB_IP: string;

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.CLOUDFLARE_API_KEY = configService.getOrThrow<string>('CLOUDFLARE_API_KEY');
    this.CLOUDFLARE_ZONE_ID = configService.getOrThrow<string>('CLOUDFLARE_ZONE_ID');
    this.OPTICS_HUB_IP = configService.getOrThrow<string>('OPTICS_HUB_IP');
  }

  private createWorkspaceRecordPayload(workspaceSubdomain: string) {
    return {
      name: `*.${workspaceSubdomain}.optics.run`,
      type: "A",
      ttl: 1,
      comment: `Subdomain for "${workspaceSubdomain}" Tenancy`,
      content: this.OPTICS_HUB_IP,
      proxied: true,
    };
  }

  private logCloudflareFailure(action: string, data: CloudflareResponse<unknown>) {
    Logger.error({
      action,
      errors: data.errors,
      messages: data.messages,
    }, CloudflareDnsUtility.name);
  }

  /*
    API Reference | /docs/Cloudflare/DNS/cloudflare-dns-create.md
    DNS 레코드를 API 키를 활용해 동적으로 생성합니다.
  */
  async createDnsRecord(workspaceSubdomain: string) {
    const response = await axios.post<CreateDnsRecordResponse>(`https://api.cloudflare.com/client/v4/zones/${this.CLOUDFLARE_ZONE_ID}/dns_records`, this.createWorkspaceRecordPayload(workspaceSubdomain), {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.CLOUDFLARE_API_KEY}`,
      },
      validateStatus: () => true,
    });

    if (!response.data.success) {
      this.logCloudflareFailure('createDnsRecord', response.data);
      return null;
    }

    return response.data.result.id;
  }

  /*
    API Reference | /docs/Cloudflare/DNS/cloudflare-dns-update.md
    이미 존재하는 DNS 레코드의 ID 값을 사용해 DNS 레코드를 업데이트 합니다.
  */
  async updateDnsRecord(workspaceSubdomain: string, dnsRecordId: string) {
    const response = await axios.patch<UpdateDnsRecordResponse>(`https://api.cloudflare.com/client/v4/zones/${this.CLOUDFLARE_ZONE_ID}/dns_records/${dnsRecordId}`, this.createWorkspaceRecordPayload(workspaceSubdomain), {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.CLOUDFLARE_API_KEY}`,
      },
      validateStatus: () => true,
    });

    if (!response.data.success) this.logCloudflareFailure('updateDnsRecord', response.data);

    return response.data.success;
  }

  /*
    API Reference | /docs/Cloudflare/DNS/cloudflare-dns-delete.md
    DNS 레코드 ID를 사용해 존재하는 DNS 레코드를 삭제합니다.
  */
  async deleteDnsRecord(dnsRecordId: string) {
    const response = await axios.delete<DeleteDnsRecordResponse>(`https://api.cloudflare.com/client/v4/zones/${this.CLOUDFLARE_ZONE_ID}/dns_records/${dnsRecordId}`, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.CLOUDFLARE_API_KEY}`,
      },
      validateStatus: () => true,
    });

    if (!response.data.success) this.logCloudflareFailure('deleteDnsRecord', response.data);

    return response.data.success;
  }
}
