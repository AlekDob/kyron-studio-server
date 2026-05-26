import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/core/auth/middleware.js";
import { findUser } from "@/features/org/store.js";
import {
  getModuleRouting,
  getProviderConnection,
  listProviderConnections,
  setProcessConfig,
  setProviderConnection,
} from "./store.js";
import { testProviderConnection } from "./provider-test.js";

type AuthedEnv = { Variables: { userId: string } };

export const settingsRoute = new Hono<AuthedEnv>();

settingsRoute.use("*", authMiddleware);

const PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "ollama",
  "glm",
  "minimax",
  "deepseek",
  "groq",
  "openai-compat",
] as const;

const modelConfigSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z
    .string()
    .trim()
    .min(1, "Model name obbligatorio — selezionane uno dalla lista"),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
});

const providerConnectionSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
});

// --- Routing per processo -----------------------------------------------

settingsRoute.get("/routing/:moduleId", async (c) => {
  const userId = c.get("userId");
  const found = await findUser(userId);
  if (!found) return c.json({ error: "no org" }, 404);
  const config = await getModuleRouting(found.org.id, c.req.param("moduleId"));
  return c.json(config);
});

settingsRoute.put("/routing/:moduleId/:processId", async (c) => {
  const userId = c.get("userId");
  const found = await findUser(userId);
  if (!found) return c.json({ error: "no org" }, 404);
  if (found.user.role !== "admin") {
    return c.json({ error: "richiesto ruolo admin" }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = modelConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "body invalido", issues: parsed.error.issues }, 400);
  }
  await setProcessConfig(
    found.org.id,
    c.req.param("moduleId"),
    c.req.param("processId"),
    parsed.data,
  );
  // Auto-prewarm fire-and-forget: se il nuovo modello e' Ollama, lo scaldiamo
  // subito cosi' la prima request dell'utente non becca il cold start (che
  // con modelli da 5-8GB richiede 15-30s la prima volta e spesso causa
  // timeout "Bad Request" nei provider strict).
  if (parsed.data.provider === "ollama" && parsed.data.model) {
    void warmOllamaModel(parsed.data.model).catch((err) => {
      console.warn("[settings] auto-prewarm failed:", err);
    });
  }
  return c.json({ ok: true });
});

async function warmOllamaModel(model: string): Promise<void> {
  const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const url = `${baseURL.replace(/\/$/, "")}/api/generate`;
  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "ok", stream: false }),
  });
  if (!res.ok) {
    console.warn(`[settings] prewarm ${model}: HTTP ${res.status}`);
    return;
  }
  await res.json();
  console.log(`[settings] prewarm ${model} ready (${Date.now() - start}ms)`);
}

// --- Connessioni provider (refactor 2026-04-20) -------------------------

settingsRoute.get("/providers", async (c) => {
  const userId = c.get("userId");
  const found = await findUser(userId);
  if (!found) return c.json({ error: "no org" }, 404);
  const providers = await listProviderConnections(found.org.id);
  // Mai ritornare la key in chiaro al client: solo flag "configured".
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
  const userId = c.get("userId");
  const found = await findUser(userId);
  if (!found) return c.json({ error: "no org" }, 404);
  if (found.user.role !== "admin") {
    return c.json({ error: "richiesto ruolo admin" }, 403);
  }
  const providerId = c.req.param("providerId");
  if (!PROVIDER_IDS.includes(providerId as (typeof PROVIDER_IDS)[number])) {
    return c.json({ error: "provider sconosciuto" }, 400);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = providerConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "body invalido", issues: parsed.error.issues }, 400);
  }
  // Preserva verifiedAt se non fornito: solo un test la aggiorna.
  const existing = await getProviderConnection(found.org.id, providerId);
  await setProviderConnection(found.org.id, providerId, {
    ...parsed.data,
    verifiedAt: existing?.verifiedAt,
  });
  return c.json({ ok: true });
});

settingsRoute.post("/providers/:providerId/test", async (c) => {
  const userId = c.get("userId");
  const found = await findUser(userId);
  if (!found) return c.json({ error: "no org" }, 404);
  const providerId = c.req.param("providerId");
  if (!PROVIDER_IDS.includes(providerId as (typeof PROVIDER_IDS)[number])) {
    return c.json({ error: "provider sconosciuto" }, 400);
  }

  const conn = await getProviderConnection(found.org.id, providerId);
  const result = await testProviderConnection(providerId, conn ?? {});

  if (result.ok) {
    await setProviderConnection(found.org.id, providerId, {
      ...(conn ?? {}),
      verifiedAt: new Date().toISOString(),
    });
  }
  return c.json(result);
});

// --- Ollama models list (usato dal Select modelli nel routing) ----------

settingsRoute.get("/ollama/models", async (c) => {
  const userId = c.get("userId");
  const found = await findUser(userId);
  const conn = found
    ? await getProviderConnection(found.org.id, "ollama")
    : null;
  const rawURL =
    conn?.baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  // Accetta sia root che /api: normalizza rimuovendo /api finale per
  // comporre coerentemente `${root}/api/tags`.
  const trimmed = rawURL.replace(/\/+$/, "");
  const baseURL = trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
  try {
    const res = await fetch(`${baseURL}/api/tags`);
    if (!res.ok) {
      return c.json({ models: [], error: `ollama ${res.status}` }, 200);
    }
    const data = (await res.json()) as {
      models?: Array<{ name: string; size?: number }>;
    };
    const models = (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size ?? 0,
    }));
    return c.json({ models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ models: [], error: msg }, 200);
  }
});
