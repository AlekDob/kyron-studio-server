import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { requireAdmin } from "@/middleware/require-admin.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { runPriceGuard } from "./check.js";
import { runAndNotify } from "./report.js";

// Modulo Price Guard — endpoint manuali (ADMIN-ONLY), stesso gate di orders-report.
// SOLO lettura su Saleor: /run non modifica nulla, al massimo invia una mail.
const priceGuardRoute = new Hono();

priceGuardRoute.use("*", tenantMiddleware);
priceGuardRoute.use("*", studioAuthMiddleware);

// POST /run — esegue il check e manda la mail se ci sono anomalie. Ritorna le anomalie.
priceGuardRoute.post("/run", requireAdmin, async (c) => {
  try {
    const anomalies = await runAndNotify();
    return c.json({ count: anomalies.length, anomalies });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

// POST /check — esegue il check senza inviare mail (dry, per un portale opzionale).
priceGuardRoute.post("/check", requireAdmin, async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { portalSlug?: string };
    const anomalies = await runPriceGuard({ portalSlug: body.portalSlug });
    return c.json({ count: anomalies.length, anomalies });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

export { priceGuardRoute };
