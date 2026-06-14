import { Hono } from "hono";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { requireAdmin } from "@/middleware/require-admin.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { sendDailyOrdersReport } from "./report.js";

// POST /api/v1/orders-report/send — trigger manuale del report ordini
// (test/recovery). ADMIN-ONLY, stesso gate del report analytics.
const ordersReportRoute = new Hono();

ordersReportRoute.use("*", tenantMiddleware);
ordersReportRoute.use("*", studioAuthMiddleware);

ordersReportRoute.post("/send", requireAdmin, async (c) => {
  try {
    await sendDailyOrdersReport();
    return c.json({ sent: true });
  } catch (err) {
    return c.json({ error: String(err) }, 502);
  }
});

export { ordersReportRoute };
