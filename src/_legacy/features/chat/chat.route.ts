import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { agentRuntime } from "@/core/agent-runtime/index.js";
import { persistConversation } from "@/core/supabase/conversations.js";
import { authMiddleware } from "@/core/auth/middleware.js";
import { resolveApproval } from "@/core/approvals/registry.js";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .min(1),
  agentId: z.string().optional(),
});

const approveRequestSchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["approve", "reject"]),
});

type AuthedEnv = { Variables: { userId: string } };

export const chatRoute = new Hono<AuthedEnv>();

chatRoute.use("*", authMiddleware);

chatRoute.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const { messages, agentId = "accounting" } = parsed.data;
  const userId = c.get("userId");

  return streamSSE(c, async (stream) => {
    console.log(`[chat] incoming - agent=${agentId} user=${userId} msgs=${messages.length}`);
    let accumulated = "";
    try {
      for await (const chunk of agentRuntime.streamChat({
        agentId,
        messages,
        userId,
      })) {
        if (chunk.type === "text") {
          accumulated += chunk.delta;
          await stream.writeSSE({
            data: JSON.stringify({ delta: chunk.delta }),
          });
        } else {
          console.log(`[chat] approval emit: ${chunk.id} (${chunk.action})`);
          await stream.writeSSE({
            data: JSON.stringify({
              approval: {
                id: chunk.id,
                title: chunk.title,
                action: chunk.action,
                details: chunk.details,
              },
            }),
          });
        }
      }
      await stream.writeSSE({ data: "[DONE]" });
      await persistConversation({
        userId,
        messages,
        assistantReply: accumulated,
        agentId,
      });
      console.log(`[chat] done - ${accumulated.length} chars streamed`);
    } catch (err) {
      const stack = err instanceof Error ? err.stack : String(err);
      console.error(`[chat] ERROR:\n${stack}`);
      const message = err instanceof Error ? err.message : "Unknown error";
      await stream.writeSSE({ data: JSON.stringify({ error: message }) });
    }
  });
});

chatRoute.post("/approve", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = approveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }
  const ok = resolveApproval(parsed.data.approvalId, parsed.data.decision);
  if (!ok) {
    return c.json({ error: "Approval non trovata o gia' risolta" }, 404);
  }
  return c.json({ ok: true });
});
