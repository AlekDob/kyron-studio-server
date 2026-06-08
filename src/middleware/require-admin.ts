import type { MiddlewareHandler } from "hono";
import { findStudioUserByEmail, type StudioRole } from "@/core/studio-users/store.js";

// Brain: feature-008-organization-users — gate admin-only.
// Va montato DOPO tenantMiddleware (serve il tenant per il lookup) e
// studioAuthMiddleware (serve l'email del cookie). Risolve il ruolo reale
// dal DB (non si fida del client) e blocca chi non e' admin attivo.
declare module "hono" {
  interface ContextVariableMap {
    studioRole: StudioRole;
  }
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const tenant = c.get("tenant");
  const user = c.get("studioUser");
  if (!tenant || !user) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const record = await findStudioUserByEmail(tenant, user.email);
  if (!record || !record.isActive) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (record.role !== "admin") {
    return c.json({ error: "admin role required" }, 403);
  }

  c.set("studioRole", record.role);
  await next();
};
