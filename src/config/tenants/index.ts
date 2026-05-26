import { kyronTenant, type TenantConfig } from "./kyron.js";

const TENANTS: Record<string, TenantConfig> = {
  kyron: kyronTenant,
};

export function getTenant(slug: string): TenantConfig | null {
  return TENANTS[slug] ?? null;
}

export function listTenants(): TenantConfig[] {
  return Object.values(TENANTS);
}

export type { TenantConfig };
