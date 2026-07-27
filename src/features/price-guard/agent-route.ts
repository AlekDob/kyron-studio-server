// Route SSE dell'agente Controlli (Price Guard). Stesso protocollo di
// onboard-school/route.ts: emette delta / tool / toolResult (+ _ui) / error / [DONE].
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { runPriceGuardAgent } from "./agent.js";

export const priceGuardAgentRoute = new Hono();

priceGuardAgentRoute.use("*", tenantMiddleware);
priceGuardAgentRoute.use("*", studioAuthMiddleware);

priceGuardAgentRoute.post("/", async (c) => {
  const tenant = c.get("tenant");
  const user = c.get("studioUser");
  const body = (await c.req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const cookie = c.req.header("Cookie") ?? "";

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runPriceGuardAgent({
        tenant,
        cookie,
        userEmail: user.email,
        messages: body.messages,
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
