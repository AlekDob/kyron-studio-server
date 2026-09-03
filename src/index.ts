import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { onboardSchoolRoute } from "@/features/onboard-school/route.js";
import { settingsRoute } from "@/features/settings/settings.route.js";
import { collectionsRoute } from "@/features/collections/route.js";
import { mediaRoute } from "@/features/media/route.js";
import { dataEditorRoute } from "@/features/data-editor/route.js";
import { reviewEditorRoute } from "@/features/review-editor/route.js";
import { portalsRoute } from "@/features/portals/route.js";
import { authRoute } from "@/features/auth/route.js";
import { studioUsersRoute } from "@/features/studio-users/route.js";
import { analyticsRoute } from "@/features/analytics/route.js";
import { armDailyReport } from "@/features/analytics/report.js";
import { ordersReportRoute } from "@/features/orders-report/route.js";
import { armDailyOrdersReport } from "@/features/orders-report/report.js";
import { ordersRoute } from "@/features/orders/route.js";
import { customersRoute } from "@/features/customers/route.js";
import { customersAgentRoute } from "@/features/customers/agent-route.js";
import { requestsRoute } from "@/features/requests/route.js";
import { requestsAgentRoute } from "@/features/requests/agent-route.js";
import { priceGuardRoute } from "@/features/price-guard/route.js";
import { commessoRoute } from "@/features/commesso/route.js";
import { commessoRestRoute } from "@/features/commesso/rest.js";
import { statsAgentRoute } from "@/features/stats-agent/route.js";
import { armDailyPriceGuard } from "@/features/price-guard/report.js";
import { vatReliefAgentRoute, vatReliefRoute } from "@/features/vat-relief/route.js";
import { getEcommerceSettings } from "@/features/settings/store.js";

// Brain: decision-013 — studio-server e' il prodotto agentico orizzontale di
// Studio Futuro. Tenant-aware via header X-Tenant. Oggi serve Kyron, domani
// N clienti con frontend brandizzati separati. Spaceship-specific modules
// (accounting, brain, workflow, bi, mcp, clients, supabase auth, vector
// store) sono stati spostati in src/_legacy/ — vedi MIGRATION-FROM-SPACESHIP.md.

const app = new Hono();

const allowedOrigins = (
  process.env.CORS_ORIGIN ?? "http://localhost:3010,https://studio.kyronedu.it"
)
  .split(",")
  .map((s) => s.trim());

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) =>
      !origin || allowedOrigins.includes(origin) ? origin ?? "*" : null,
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "studio-server" }));
// Brain: decision-019 — config ecommerce pubblica (no auth) per lo storefront:
// la % sconto bonifico per il SOLO display (il calcolo reale e' nel voucher Saleor).
app.get("/public/ecommerce-config", async (c) => {
  const settings = await getEcommerceSettings();
  return c.json(settings);
});
app.route("/agents/onboard-school", onboardSchoolRoute);
app.route("/settings", settingsRoute);
app.route("/api/v1/collections", collectionsRoute);
app.route("/api/v1/media", mediaRoute);
app.route("/agents/data-editor", dataEditorRoute);
app.route("/agents/review-editor", reviewEditorRoute);
app.route("/agents/stats", statsAgentRoute);
app.route("/agents/vat-relief", vatReliefAgentRoute);
app.route("/api/v1/portals", portalsRoute);
app.route("/auth", authRoute);
app.route("/api/v1/studio-users", studioUsersRoute);
app.route("/api/v1/analytics", analyticsRoute);
app.route("/api/v1/orders-report", ordersReportRoute);
app.route("/api/v1/orders", ordersRoute);
app.route("/api/v1/price-guard", priceGuardRoute);
app.route("/api/v1/vat-relief", vatReliefRoute);
app.route("/agents/commesso", commessoRoute);
app.route("/agents/customers", customersAgentRoute);
app.route("/agents/requests", requestsAgentRoute);
app.route("/api/v1/products", commessoRestRoute);
app.route("/api/v1/customers", customersRoute);
app.route("/api/v1/requests", requestsRoute);

// Report analytics giornaliero via email (opt-in: ANALYTICS_REPORT_ENABLED).
armDailyReport();
// Report ordini giornaliero via email alle 09:30 (opt-in: ORDERS_REPORT_ENABLED).
armDailyOrdersReport();
// Price Guard: check prezzi/sconti alle 08:00, mail solo se anomalie (opt-in: PRICE_GUARD_ENABLED).
armDailyPriceGuard();

const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[studio-server] listening on http://localhost:${info.port}`);
});
