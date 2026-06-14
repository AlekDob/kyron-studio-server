import { Hono } from "hono";
import { z } from "zod";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { fetchOrdersForRange } from "@/core/saleor/orders.js";
import { buildPortalIndex, enrichOrder, type EnrichedOrder } from "./enrich.js";

// GET /api/v1/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&portal=slug&agent=email
// Vista situazione ordini per i commerciali (feature 008). Accesso: tutti gli
// utenti Studio loggati (read-only, no requireAdmin). Brain: feature 007 (ordini Saleor).
const ordersRoute = new Hono();

ordersRoute.use("*", tenantMiddleware);
ordersRoute.use("*", studioAuthMiddleware);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_RE).optional();

const querySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  portal: z.string().optional(),
  agent: z.string().optional(),
});

// Data UTC YYYY-MM-DD a `days` giorni fa (0 = oggi).
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Match agente: confronto case-insensitive su email completa o local-part.
function matchesAgent(order: EnrichedOrder, agent: string): boolean {
  const a = agent.toLowerCase();
  const email = order.agent.toLowerCase();
  return email === a || email.split("@")[0] === a;
}

ordersRoute.get("/", async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "invalid_query" }, 400);
  }
  const { from, to, portal, agent } = parsed.data;
  const fromDate = from ?? isoDaysAgo(30);
  const toDate = to ?? isoDaysAgo(0);
  try {
    const index = await buildPortalIndex();
    let orders = (await fetchOrdersForRange(fromDate, toDate)).map((o) =>
      enrichOrder(o, index),
    );
    if (portal) orders = orders.filter((o) => o.channelSlug === portal);
    if (agent) orders = orders.filter((o) => matchesAgent(o, agent));
    const totalGross = orders.reduce((sum, o) => sum + o.totalGross, 0);
    return c.json({
      from: fromDate,
      to: toDate,
      count: orders.length,
      totalGross,
      orders,
    });
  } catch (err) {
    return c.json({ error: "orders_failed", detail: String(err) }, 502);
  }
});

export { ordersRoute };
