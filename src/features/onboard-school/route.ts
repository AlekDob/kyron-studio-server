import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantMiddleware } from "@/core/tenant/middleware.js";
import { studioAuthMiddleware } from "@/middleware/studio-auth.js";
import { runOnboardSchoolAgent } from "./agent.js";

export const onboardSchoolRoute = new Hono();

onboardSchoolRoute.use("*", tenantMiddleware);
// Brain: onboarding richiede login — cosi' sappiamo SEMPRE quale agente Studio
// (utente loggato, identificato via email nel cookie kyron-rev) ha richiesto
// l'onboarding. Coerente con data-editor/review-editor. Il frontend inoltra gia'
// il cookie via il proxy /api/agent/onboard-school.
onboardSchoolRoute.use("*", studioAuthMiddleware);

// Brain: protocollo SSE allineato a Virgilio chat-runtime + WS04 (decision-015).
// Emette `delta`, `tool` (con args), `toolResult` (con result + opzionale _ui descriptor
// per generative UI), `error`, e `[DONE]`. Il client (OnboardingChat) parsa _ui
// dal toolResult e renderizza i componenti dal registry generativo.

onboardSchoolRoute.post("/", async (c) => {
  const tenant = c.get("tenant");
  const user = c.get("studioUser");
  const body = (await c.req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const cookie = c.req.header("Cookie") ?? "";

  return streamSSE(c, async (stream) => {
    try {
      for await (const chunk of runOnboardSchoolAgent({
        tenant,
        cookie,
        userEmail: user.email,
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
              result: chunk.result,
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
