import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  authMiddleware,
  authContextFrom,
  type AuthedVars,
} from "@/core/auth/middleware.js";
import { resolveForProcess } from "@/core/llm/resolver.js";
import {
  withRequestContext,
  type EmitApproval,
} from "@/core/approvals/registry.js";
import { findUser } from "@/features/org/store.js";
import { getClient } from "@/features/clients/store/clients.store.js";
import { withClientScopedContext } from "./agent/scoped-context.js";
import { buildSpecialistContext } from "./agent/context-builder.js";
import { makeClientSpecialistAgent } from "./agent/index.js";

export const clientChatRoute = new Hono<{ Variables: AuthedVars }>();

clientChatRoute.use("*", authMiddleware);

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

clientChatRoute.post("/:clientId/chat", async (c) => {
  const clientId = c.req.param("clientId");
  const auth = authContextFrom(c);
  const tenantCtx = {
    orgId: auth.orgId,
    userId: auth.userId,
    roles: auth.roles,
  };

  const body = (await c.req.json()) as { messages: ChatMessage[] };
  if (!Array.isArray(body.messages)) {
    return c.json({ error: "messages richiesto" }, 400);
  }

  const client = await getClient(tenantCtx, clientId);
  if (!client) return c.json({ error: "Cliente non trovato" }, 404);

  const specialistCtx = await buildSpecialistContext(tenantCtx, clientId);
  // settings.json usa l'orgId-stringa (es. "org-dev") da orgs.json, non l'UUID
  // usato per RLS. Per il resolver LLM serve quindi la stringa di findUser().
  const settingsOrgId = (await findUser(auth.userId))?.org.id ?? auth.orgId;
  const model = await resolveForProcess(settingsOrgId, "clients", "specialist");
  if (!model) {
    return c.json(
      { error: "Nessun LLM configurato per il modulo Clients" },
      503,
    );
  }
  const agent = makeClientSpecialistAgent(model, client.name, specialistCtx);

  return streamSSE(c, async (stream) => {
    const emitApproval: EmitApproval = (req) => {
      void stream.writeSSE({
        event: "approval_request",
        data: JSON.stringify(req),
      });
    };

    await withClientScopedContext(
      { orgId: auth.orgId, userId: auth.userId, clientId },
      () =>
        withRequestContext({ emitApproval }, async () => {
          try {
            // maxSteps: 6 = agente puo' fare fino a 6 tool-call prima di chiudere.
            // Senza questo l'agente si ferma dopo 1 step = solo tool-call senza text-delta finale.
            const result = await agent.stream(body.messages, { maxSteps: 6 });
            // fullStream copre text-delta + tool-call + tool-result + error + finish.
            // textStream da solo salta tool events e tace se la risposta e' solo tool calls.
            const fullStream = (
              result as unknown as {
                fullStream?: AsyncIterable<{ type: string; [k: string]: unknown }>;
              }
            ).fullStream;
            if (fullStream) {
              for await (const part of fullStream) {
                if (part.type === "text-delta") {
                  const delta = (part as { textDelta?: string }).textDelta;
                  if (delta) await stream.writeSSE({ event: "delta", data: delta });
                } else if (part.type === "error") {
                  const payload = JSON.stringify(part).slice(0, 300);
                  console.error(`[client-specialist] stream error: ${payload}`);
                  await stream.writeSSE({
                    event: "delta",
                    data: `\n\n_[errore LLM: ${payload}]_`,
                  });
                }
              }
            } else {
              for await (const chunk of result.textStream) {
                await stream.writeSSE({ event: "delta", data: chunk });
              }
            }
            await stream.writeSSE({ event: "done", data: "" });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[client-specialist] caught error: ${message}`);
            await stream.writeSSE({
              event: "delta",
              data: `\n\n_[errore runtime: ${message}]_`,
            });
            await stream.writeSSE({ event: "done", data: "" });
          }
        }),
    );
  });
});
