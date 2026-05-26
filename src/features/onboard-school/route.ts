import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { runOnboardSchoolAgent } from "./agent.js";

export const onboardSchoolRoute = new Hono();

onboardSchoolRoute.use("*", tenantMiddleware);

// Brain: protocollo SSE allineato a Virgilio chat-runtime.
// Emette `data: {"delta":"..."}\n\n` per ogni text-delta dell'AI SDK,
// `data: {"error":"..."}\n\n` su exception, `data: [DONE]\n\n` a fine stream.
// Il client (OnboardingChat) usa lo stesso buffer split su `\n\n`.

onboardSchoolRoute.post("/", async (c) => {
  const tenant = c.get("tenant");
  const body = (await c.req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const cookie = c.req.header("Cookie") ?? "";

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runOnboardSchoolAgent({
        tenant,
        cookie,
        messages: body.messages,
      })) {
        if (chunk.type === "text-delta") {
          await stream.writeSSE({
            data: JSON.stringify({ delta: chunk.textDelta }),
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
