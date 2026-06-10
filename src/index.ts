import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { onboardSchoolRoute } from "@/features/onboard-school/route.js";
import { settingsRoute } from "@/features/settings/settings.route.js";
import { collectionsRoute } from "@/features/collections/route.js";
import { dataEditorRoute } from "@/features/data-editor/route.js";
import { reviewEditorRoute } from "@/features/review-editor/route.js";
import { portalsRoute } from "@/features/portals/route.js";
import { authRoute } from "@/features/auth/route.js";
import { studioUsersRoute } from "@/features/studio-users/route.js";
import { analyticsRoute } from "@/features/analytics/route.js";

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
app.route("/agents/onboard-school", onboardSchoolRoute);
app.route("/settings", settingsRoute);
app.route("/api/v1/collections", collectionsRoute);
app.route("/agents/data-editor", dataEditorRoute);
app.route("/agents/review-editor", reviewEditorRoute);
app.route("/api/v1/portals", portalsRoute);
app.route("/auth", authRoute);
app.route("/api/v1/studio-users", studioUsersRoute);
app.route("/api/v1/analytics", analyticsRoute);

const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[studio-server] listening on http://localhost:${info.port}`);
});
