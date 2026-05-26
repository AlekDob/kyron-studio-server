export interface TenantConfig {
  slug: string;
  payloadApiUrl: string;
  payloadApiKey: string;
  agents: string[];
}

export const kyronTenant: TenantConfig = {
  slug: "kyron",
  payloadApiUrl:
    process.env.TENANT_KYRON_PAYLOAD_API_URL ?? "https://kyronedu.it/api",
  payloadApiKey: process.env.TENANT_KYRON_PAYLOAD_API_KEY ?? "",
  agents: ["onboard-school"],
};
