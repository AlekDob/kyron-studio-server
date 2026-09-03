// GET /api/v1/requests — i ticket del progetto Kyron su Linear (feature 022).
// Accesso: tutti gli utenti Studio loggati. Niente requireAdmin: le richieste
// le aprono i colleghi, non gli admin.
import { Hono } from "hono";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { listRequests } from "./service.js";

export const requestsRoute = new Hono();

requestsRoute.use("*", tenantMiddleware);
requestsRoute.use("*", studioAuthMiddleware);

requestsRoute.get("/", async (c) => {
  try {
    const requests = await listRequests();
    return c.json({ count: requests.length, requests });
  } catch (err) {
    return c.json({ error: "requests_failed", detail: String(err) }, 502);
  }
});
