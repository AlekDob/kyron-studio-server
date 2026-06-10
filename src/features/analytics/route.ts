import { Hono } from "hono";
import { z } from "zod";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { getOverview } from "./service.js";
import { PosthogConfigError, PosthogQueryError } from "./posthog.js";

// GET /api/v1/analytics/overview?range=7d|30d|90d
// Accesso: tutti gli utenti Studio (aggregati read-only, nessun PII).
// Brain: decision-017.

const analyticsRoute = new Hono();

analyticsRoute.use("*", tenantMiddleware);
analyticsRoute.use("*", studioAuthMiddleware);

const rangeSchema = z.enum(["7d", "30d", "90d"]).default("30d");

analyticsRoute.get("/overview", async (c) => {
  const parsed = rangeSchema.safeParse(c.req.query("range") ?? undefined);
  if (!parsed.success) {
    return c.json({ error: "invalid range (7d|30d|90d)" }, 400);
  }
  try {
    return c.json(await getOverview(parsed.data));
  } catch (err) {
    if (err instanceof PosthogConfigError) {
      return c.json({ error: "posthog_not_configured" }, 503);
    }
    if (err instanceof PosthogQueryError) {
      return c.json({ error: "posthog_error", detail: err.message }, 502);
    }
    throw err;
  }
});

export { analyticsRoute };
