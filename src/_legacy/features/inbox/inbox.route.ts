import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { authMiddleware } from "@/core/auth/middleware.js";
import { listAgents } from "@/core/agent-runtime/registry.js";
import { agentRuntime } from "@/core/agent-runtime/index.js";
import { eventBus, type InboxEvent } from "@/core/events/bus.js";
import {
  listConversations,
  createConversation,
  getConversation,
  listMessages,
  appendMessage,
  touchConversation,
  resetUnread,
  deleteConversation,
} from "./store.js";
import { createConversationSchema, postMessageSchema } from "./types.js";

type AuthedEnv = { Variables: { userId: string } };

export const inboxRoute = new Hono<AuthedEnv>();

inboxRoute.use("*", authMiddleware);

inboxRoute.get("/agents", (c) => {
  return c.json({ agents: listAgents() });
});

inboxRoute.get("/conversations", async (c) => {
  const userId = c.get("userId");
  const conversations = await listConversations(userId);
  return c.json({ conversations });
});

// Aggregate total unread count across all conversations of the user.
// Questo e' l'endpoint usato dai badge del Launcher/Titlebar.
inboxRoute.get("/unread-count", async (c) => {
  const userId = c.get("userId");
  const conversations = await listConversations(userId);
  const total = conversations.reduce((acc, c) => acc + (c.unreadCount ?? 0), 0);
  return c.json({ total });
});

// SSE stream globale: notifica al client ogni volta che una conversation dell'utente
// riceve un nuovo messaggio. Usato per badge real-time, toast, OS notifications.
inboxRoute.get("/stream", async (c) => {
  const userId = c.get("userId");
  return streamSSE(c, async (stream) => {
    const unsubscribe = eventBus.onInbox((event: InboxEvent) => {
      if (event.userId !== userId) return;
      void stream.writeSSE({
        data: JSON.stringify(event),
      });
    });

    // Mantieni il canale aperto con un heartbeat ogni 30s.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: "" }).catch(() => {});
    }, 30_000);

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      });
    });
  });
});

inboxRoute.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const conversationId = c.req.param("id");
  const ok = await deleteConversation(conversationId, userId);
  if (!ok) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  return c.json({ ok: true });
});

inboxRoute.post("/conversations", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createConversationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }
  const userId = c.get("userId");
  const conv = await createConversation(
    userId,
    parsed.data.agentId,
    parsed.data.title,
  );
  return c.json(conv, 201);
});

inboxRoute.get("/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const limit = Number(c.req.query("limit") ?? 50);
  const cursor = c.req.query("cursor") ?? undefined;
  await resetUnread(conversationId);
  const result = await listMessages(conversationId, limit, cursor);
  return c.json(result);
});

inboxRoute.post("/:id/messages", async (c) => {
  const conversationId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = postMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const userId = c.get("userId");
  const conv = await getConversation(conversationId);
  if (!conv) {
    return c.json({ error: "Conversation not found" }, 404);
  }
  if (!conv.agentId) {
    return c.json({ error: "Conversation has no agent" }, 400);
  }

  await appendMessage(conversationId, "user", parsed.data.content);
  await touchConversation(conversationId, parsed.data.content, false);

  const history = await listMessages(conversationId, 200);
  const chatMessages = history.messages.map((m) => ({
    role: m.role === "agent" ? ("assistant" as const) : (m.role as "user" | "system"),
    content: m.content,
  }));

  return streamSSE(c, async (stream) => {
    const agentId = conv.agentId!;
    console.log(`[inbox] streaming - conv=${conversationId} agent=${agentId}`);
    let accumulated = "";

    try {
      for await (const chunk of agentRuntime.streamChat({
        agentId,
        messages: chatMessages,
        userId,
      })) {
        if (chunk.type === "text") {
          accumulated += chunk.delta;
          await stream.writeSSE({
            data: JSON.stringify({ delta: chunk.delta }),
          });
        } else {
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

      await appendMessage(conversationId, "agent", accumulated);
      await touchConversation(conversationId, accumulated, true);

      console.log(`[inbox] done - ${accumulated.length} chars`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[inbox] ERROR: ${message}`);
      await stream.writeSSE({ data: JSON.stringify({ error: message }) });
    }
  });
});
