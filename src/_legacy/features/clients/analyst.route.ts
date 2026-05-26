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
import { buildAnalystContext } from "./agent/analyst-context-builder.js";
import { makeAnalystAgent } from "./agent/analyst-index.js";
import { setAnalystToolContext } from "./agent/tools/search-clients.tool.js";

export const analystChatRoute = new Hono<{ Variables: AuthedVars }>();

analystChatRoute.use("*", authMiddleware);

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

analystChatRoute.post("/analyst/chat", async (c) => {
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

  const analystCtx = await buildAnalystContext(tenantCtx);
  // settings.json usa l'orgId-stringa (es. "org-dev") da orgs.json, non l'UUID
  // usato per RLS. Per il resolver LLM serve quindi la stringa di findUser().
  const settingsOrgId = (await findUser(auth.userId))?.org.id ?? auth.orgId;
  const model = await resolveForProcess(settingsOrgId, "clients", "analyst");
  if (!model) {
    return c.json(
      { error: "Nessun LLM configurato per il modulo Clients" },
      503,
    );
  }
  const agent = makeAnalystAgent(model, analystCtx);

  return streamSSE(c, async (stream) => {
    const emitApproval: EmitApproval = (req) => {
      void stream.writeSSE({
        event: "approval_request",
        data: JSON.stringify(req),
      });
    };

    setAnalystToolContext({
      orgId: auth.orgId,
      userId: auth.userId,
      roles: auth.roles,
    });
    try {
      await withRequestContext({ emitApproval }, async () => {
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
              } else if (part.type === "tool-result") {
                // Intercetta focus_client → evento client_focus (drill-down).
                // Intercetta search_clients → evento clients_highlight (highlight in list).
                const toolName = (part as { toolName?: string }).toolName;
                const raw = (part as { result?: Record<string, unknown> }).result;
                if (toolName === "focus_client") {
                  const r = raw as { ok?: boolean; clientId?: string | null } | undefined;
                  if (r?.ok && r.clientId) {
                    await stream.writeSSE({
                      event: "client_focus",
                      data: JSON.stringify({ clientId: r.clientId }),
                    });
                  }
                } else if (toolName === "search_clients") {
                  const r = raw as { items?: Array<Record<string, unknown>>; total?: number } | undefined;
                  const items = Array.isArray(r?.items) ? r.items.slice(0, 50) : [];
                  if (items.length > 0) {
                    await stream.writeSSE({
                      event: "clients_highlight",
                      data: JSON.stringify({
                        items,
                        total: r?.total ?? items.length,
                      }),
                    });
                  }
                }
              } else if (part.type === "error") {
                const payload = JSON.stringify(part).slice(0, 300);
                console.error(`[portfolio-analyst] stream error: ${payload}`);
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
          console.error(`[portfolio-analyst] caught error: ${message}`);
          await stream.writeSSE({
            event: "delta",
            data: `\n\n_[errore runtime: ${message}]_`,
          });
          await stream.writeSSE({ event: "done", data: "" });
        }
      });
    } finally {
      setAnalystToolContext(null);
    }
  });
});
