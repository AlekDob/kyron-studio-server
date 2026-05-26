import type { MiddlewareHandler } from "hono";
import { getTenant, type TenantConfig } from "@/config/tenants/index.js";

declare module "hono" {
  interface ContextVariableMap {
    tenant: TenantConfig;
  }
}

export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  const slug = c.req.header("X-Tenant");
  if (!slug) {
    return c.json({ error: "missing X-Tenant header" }, 400);
  }
  const tenant = getTenant(slug);
  if (!tenant) {
    return c.json({ error: `unknown tenant: ${slug}` }, 400);
  }
  c.set("tenant", tenant);
  await next();
};
