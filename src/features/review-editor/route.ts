import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { runReviewEditorAgent } from "./agent.js";

export const reviewEditorRoute = new Hono();

reviewEditorRoute.use("*", tenantMiddleware);
reviewEditorRoute.use("*", studioAuthMiddleware);

interface ReviewEditorBody {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  context?: {
    currentUrl?: string;
    currentPath?: string;
    annotationsCount?: number;
  };
}

reviewEditorRoute.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = (await c.req.json()) as ReviewEditorBody;

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runReviewEditorAgent({
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
