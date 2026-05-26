import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { runDataEditorAgent } from "./agent.js";

export const dataEditorRoute = new Hono();

dataEditorRoute.use("*", tenantMiddleware);
dataEditorRoute.use("*", studioAuthMiddleware);

interface DataEditorBody {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  context?: { slug?: string; id?: string | number };
}

dataEditorRoute.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = (await c.req.json()) as DataEditorBody;

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runDataEditorAgent({
        tenant,
        context: body.context,
        messages: body.messages,
      })) {
        if (chunk.type === "text-delta") {
          await stream.writeSSE({
            data: JSON.stringify({ delta: chunk.textDelta }),
          });
        } else if (chunk.type === "tool-call") {
          await stream.writeSSE({
            data: JSON.stringify({
              tool: chunk.toolName,
              args: chunk.args,
            }),
          });
        } else if (chunk.type === "tool-result") {
          await stream.writeSSE({
            data: JSON.stringify({
              toolResult: chunk.toolName,
              ok: true,
            }),
          });
        } else if (chunk.type === "error") {
          const err = chunk.error;
          await stream.writeSSE({
            data: JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
          });
        }
      }
      await stream.writeSSE({ data: "[DONE]" });
    } catch (err) {
      await stream.writeSSE({
        data: JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      });
      await stream.writeSSE({ data: "[DONE]" });
    }
  });
});
