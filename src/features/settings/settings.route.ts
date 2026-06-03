import { Hono } from "hono";
import { z } from "zod";
import {
  getModuleRouting,
  getProviderConnection,
  listProviderConnections,
  setProcessConfig,
  setProviderConnection,
  PROVIDER_IDS,
  type ProviderId,
} from "./store.js";
import { testProviderConnection } from "./provider-test.js";
import { listProviderModels } from "./list-models.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";

export const settingsRoute = new Hono();

// Brain: gotcha-docker-publish-bypasses-firewall (security audit 2026-06-03).
// /settings configura provider AI + model routing ed esegue test che CONSUMANO
// la API key: va protetto come collections/data-editor. Prima era pubblico su
// studio-server.kyronedu.it (live). Richiede sessione Studio (cookie kyron-rev).
settingsRoute.use("*", studioAuthMiddleware);

const modelConfigSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1, "Model name obbligatorio"),
});

const providerConnectionSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
});

function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

// --- Routing per processo -----------------------------------------------

settingsRoute.get("/routing/:moduleId", async (c) => {
  const config = await getModuleRouting(c.req.param("moduleId"));
  return c.json(config);
});

settingsRoute.put("/routing/:moduleId/:processId", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = modelConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "body invalido", issues: parsed.error.issues }, 400);
  }
  await setProcessConfig(
    c.req.param("moduleId"),
    c.req.param("processId"),
    parsed.data,
  );
  return c.json({ ok: true });
});

// --- Connessioni provider -----------------------------------------------

settingsRoute.get("/providers", async (c) => {
  const providers = await listProviderConnections();
  const safe = Object.fromEntries(
    Object.entries(providers).map(([id, conn]) => [
      id,
      {
        configured: Boolean(conn.apiKey || conn.baseURL || id === "ollama"),
        hasApiKey: Boolean(conn.apiKey),
        baseURL: conn.baseURL ?? null,
        verifiedAt: conn.verifiedAt ?? null,
      },
    ]),
  );
  return c.json({ providers: safe });
});

settingsRoute.put("/providers/:providerId", async (c) => {
  const providerId = c.req.param("providerId");
  if (!isProviderId(providerId)) {
    return c.json({ error: "provider sconosciuto" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = providerConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "body invalido", issues: parsed.error.issues }, 400);
  }
  const existing = await getProviderConnection(providerId);
  await setProviderConnection(providerId, {
    apiKey: parsed.data.apiKey ?? existing?.apiKey,
    baseURL: parsed.data.baseURL ?? existing?.baseURL,
    verifiedAt: existing?.verifiedAt,
  });
  return c.json({ ok: true });
});

settingsRoute.post("/providers/:providerId/test", async (c) => {
  const providerId = c.req.param("providerId");
  if (!isProviderId(providerId)) {
    return c.json({ error: "provider sconosciuto" }, 400);
  }
  const conn = await getProviderConnection(providerId);
  const result = await testProviderConnection(providerId, conn ?? {});
  if (result.ok) {
    await setProviderConnection(providerId, {
      ...(conn ?? {}),
      verifiedAt: new Date().toISOString(),
    });
  }
  return c.json(result);
});

settingsRoute.get("/providers/:providerId/models", async (c) => {
  const providerId = c.req.param("providerId");
  if (!isProviderId(providerId)) {
    return c.json({ models: [], error: "provider sconosciuto" }, 400);
  }
  const conn = await getProviderConnection(providerId);
  const result = await listProviderModels(providerId, conn ?? {});
  return c.json(result);
});
