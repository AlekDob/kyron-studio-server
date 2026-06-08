import { Hono } from "hono";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { findStudioUserByEmail } from "@/core/studio-users/store.js";

// Brain: feature-008-organization-users — endpoint auth dello Studio.
// `/resolve` e' PRE-LOGIN (no cookie): il frontend lo chiama in fase di login
// OTP per sapere se l'email e' in allowlist e con quale ruolo. `/me` e'
// POST-LOGIN: ritorna ruolo dell'utente loggato per il gating UI.
export const authRoute = new Hono();

authRoute.use("*", tenantMiddleware);

// GET /auth/resolve?email=... — usato da login request/verify (no cookie).
authRoute.get("/resolve", async (c) => {
  const tenant = c.get("tenant");
  const email = c.req.query("email");
  if (!email) return c.json({ error: "missing email" }, 400);

  const record = await findStudioUserByEmail(tenant, email);
  const allowed = Boolean(record && record.isActive);
  return c.json({ allowed, role: allowed ? record!.role : null });
});

// GET /auth/me — utente loggato corrente (richiede cookie kyron-rev).
authRoute.get("/me", studioAuthMiddleware, async (c) => {
  const tenant = c.get("tenant");
  const user = c.get("studioUser");
  const record = await findStudioUserByEmail(tenant, user.email);
  if (!record || !record.isActive) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ email: record.email, role: record.role });
});
