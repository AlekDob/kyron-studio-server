import { Hono } from "hono";
import { authMiddleware } from "@/core/auth/middleware.js";
import {
  McpServerCreateSchema,
  McpServerUpdateSchema,
  getMcpStore,
  mcpPool,
} from "./index.js";

type AuthedEnv = { Variables: { userId: string } };

export const mcpRoute = new Hono<AuthedEnv>();
mcpRoute.use("*", authMiddleware);

const orgId = "org-dev"; // M4: extract from auth token

// ── CRUD ────────────────────────────────────────────────────

mcpRoute.get("/servers", async (c) => {
  const store = getMcpStore();
  const servers = await store.list(orgId);
  // Non leakare env con password — sostituisco valori con mascheramento
  const safe = servers.map(maskServerSecrets);
  return c.json({ servers: safe });
});

mcpRoute.get("/servers/:id", async (c) => {
  const id = c.req.param("id");
  const store = getMcpStore();
  const server = await store.get(orgId, id);
  if (!server) return c.json({ error: "Server non trovato" }, 404);
  return c.json({ server: maskServerSecrets(server) });
});

mcpRoute.post("/servers", async (c) => {
  const parsed = McpServerCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const store = getMcpStore();
  try {
    const created = await store.create(orgId, parsed.data);
    await mcpPool.reload(orgId);
    return c.json({ server: maskServerSecrets(created) }, 201);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Errore sconosciuto" },
      400,
    );
  }
});

mcpRoute.patch("/servers/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = McpServerUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const store = getMcpStore();
  try {
    const updated = await store.update(orgId, id, parsed.data);
    await mcpPool.reload(orgId);
    return c.json({ server: maskServerSecrets(updated) });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Errore sconosciuto" },
      400,
    );
  }
});

mcpRoute.delete("/servers/:id", async (c) => {
  const id = c.req.param("id");
  const store = getMcpStore();
  const ok = await store.delete(orgId, id);
  if (!ok) return c.json({ error: "Server non trovato" }, 404);
  await mcpPool.dropServer(orgId, id);
  return c.json({ ok: true });
});

// ── Test connection ─────────────────────────────────────────

mcpRoute.post("/servers/:id/test", async (c) => {
  const id = c.req.param("id");
  const store = getMcpStore();
  const cfg = await store.get(orgId, id);
  if (!cfg) return c.json({ error: "Server non trovato" }, 404);
  const probe = await mcpPool.probe(cfg);
  await store.markVerified(orgId, id, probe.ok ? undefined : probe.error);
  return c.json({
    ok: probe.ok,
    serverName: cfg.name,
    toolCount: probe.tools.length,
    tools: probe.tools,
    error: probe.error,
    durationMs: probe.durationMs,
  });
});

// ── Tool listing per agente ─────────────────────────────────

mcpRoute.get("/tools", async (c) => {
  const agentId = c.req.query("agentId");
  if (!agentId) return c.json({ error: "agentId obbligatorio" }, 400);
  const tools = await mcpPool.listToolsForAgent(orgId, agentId);
  return c.json({ tools });
});

// ── Reload forzato (comodo in debug) ────────────────────────

mcpRoute.post("/reload", async (c) => {
  await mcpPool.reload(orgId);
  const store = getMcpStore();
  const servers = await store.list(orgId);
  return c.json({
    ok: true,
    serverCount: servers.length,
    enabledCount: servers.filter((s) => s.enabled).length,
  });
});

// ── Audit log tail ──────────────────────────────────────────

mcpRoute.get("/audit", async (c) => {
  const { auditFilePath } = await import("./audit.js");
  const path = auditFilePath(orgId);
  const { existsSync } = await import("node:fs");
  if (!existsSync(path)) return c.json({ entries: [] });
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(path, "utf8");
  const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
  const entries = raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(-limit)
    .reverse()
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((e) => e != null);
  return c.json({ entries });
});

// ──────────────────────────────────────────────────────────
// Mascheramento env con sospetti segreti
// ──────────────────────────────────────────────────────────

function maskServerSecrets<T extends { env?: Record<string, string>; command?: string; args?: string[] }>(
  server: T,
): T {
  const env = server.env ?? {};
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    masked[k] = looksSecret(k) ? maskValue(v) : v;
  }
  const args = (server.args ?? []).map((a) => maskArgIfSecret(a));
  return { ...server, env: masked, args };
}

function looksSecret(key: string): boolean {
  return /password|secret|token|api[_-]?key|credential/i.test(key);
}

function maskValue(v: string): string {
  if (v.length <= 4) return "••••";
  return v.slice(0, 2) + "•".repeat(Math.min(v.length - 4, 8)) + v.slice(-2);
}

function maskArgIfSecret(arg: string): string {
  // Se contiene "password=", "://user:pwd@" o simili, maschera la parte sensibile
  if (/:\/\/[^:]+:[^@]+@/.test(arg)) {
    return arg.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:••••@");
  }
  return arg;
}
