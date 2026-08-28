// Route SSE dell'agente Commesso (Nico). Stesso protocollo di
// onboard-school/route.ts: emette delta / tool / toolResult (+ _ui) / error / [DONE].
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { requireAdmin } from "@/middleware/require-admin.js";
import { runCommessoAgent, type AgentScope } from "./agent.js";

export const commessoRoute = new Hono();

commessoRoute.use("*", tenantMiddleware);
commessoRoute.use("*", studioAuthMiddleware);

// ponytail: admin-only per tutti e due gli scope, perche' dal Catalogo si
// scrivono prezzi di produzione. Il pannello Ordini invece (/api/v1/orders) e'
// aperto a ogni utente Studio: chi non e' admin vede la lista ma non ha Nico
// accanto. Serve un ruolo intermedio per aprire il solo scope "orders".
commessoRoute.post("/", requireAdmin, async (c) => {
  const tenant = c.get("tenant");
  const user = c.get("studioUser");
  const body = (await c.req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    scope?: string;
  };
  // Lo scope arriva dal modulo che ha aperto la chat: default catalogo.
  const scope: AgentScope = body.scope === "orders" ? "orders" : "catalogo";
  const cookie = c.req.header("Cookie") ?? "";

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runCommessoAgent({
        tenant,
        cookie,
        userEmail: user.email,
        messages: body.messages,
        scope,
      })) {
        if (chunk.type === "text-delta") {
          await stream.writeSSE({ data: JSON.stringify({ delta: chunk.textDelta }) });
        } else if (chunk.type === "tool-call") {
          await stream.writeSSE({ data: JSON.stringify({ tool: chunk.toolName, args: chunk.args }) });
        } else if (chunk.type === "tool-result") {
          await stream.writeSSE({
            data: JSON.stringify({ toolResult: chunk.toolName, ok: true, result: chunk.result }),
          });
        } else if (chunk.type === "error") {
          const err = chunk.error;
          await stream.writeSSE({
            data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          });
        }
      }
      await stream.writeSSE({ data: "[DONE]" });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      });
      await stream.writeSSE({ data: "[DONE]" });
    }
  });
});
