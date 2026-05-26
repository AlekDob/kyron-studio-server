import { supabaseService } from "@/core/supabase/client.js";
import { eventBus } from "@/core/events/bus.js";
import type { Conversation, Message } from "./types.js";
import {
  memListConversations,
  memCreateConversation,
  memGetConversation,
  memListMessages,
  memAppendMessage,
  memTouchConversation,
  memResetUnread,
  memDeleteConversation,
} from "./memory.store.js";
import {
  fileListConversations,
  fileCreateConversation,
  fileGetConversation,
  fileListMessages,
  fileAppendMessage,
  fileTouchConversation,
  fileResetUnread,
  fileDeleteConversation,
} from "./file.store.js";

/**
 * Brain: 024-workflow-module
 * Dispatch globale coerente col workflow store:
 *  - SPACESHIP_STORE=supabase -> Supabase (se configurato)
 *  - SPACESHIP_STORE=file -> JSON su disco (~/.spaceship/inbox/)
 *  - SPACESHIP_STORE=memory -> RAM (default dev, perso al restart)
 *  - non settato -> "file" se c'e' HOME, altrimenti "memory"
 */
type StoreMode = "supabase" | "file" | "memory";

function resolveStoreMode(): StoreMode {
  const env = process.env.SPACESHIP_STORE?.toLowerCase();
  if (env === "supabase" || env === "file" || env === "memory") return env;
  // Default out-of-the-box: file persistency, cosi' il pilot funziona
  // subito senza env var. Memory lo si sceglie esplicitamente per test.
  return "file";
}

const storeMode = resolveStoreMode();
console.log(`[inbox-store] mode=${storeMode}`);

/**
 * Dispatcher store: uses Supabase when configured, in-memory fallback otherwise.
 * Matches runtime's dev-agent pattern for infra-less local development.
 *
 * Brain: 022-inbox-module
 * Brain: dev-mode-requires-memory-fallback — never throw on missing infra in dev
 */

let warnedNoSupabase = false;
function warnOnce(): void {
  if (warnedNoSupabase) return;
  warnedNoSupabase = true;
  console.warn("[inbox-store] Supabase not configured - using in-memory fallback");
}

function mapConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    agentId: row.agent_id ? String(row.agent_id) : null,
    title: String(row.title),
    lastMessageAt: String(row.last_message_at),
    unreadCount: Number(row.unread_count ?? 0),
    createdAt: String(row.created_at),
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    role: String(row.role) as Message["role"],
    content: String(row.content),
    toolCalls: row.tool_calls ?? null,
    createdAt: String(row.created_at),
  };
}

function shouldUseSupabase(): boolean {
  return storeMode === "supabase" && !!supabaseService;
}

function shouldUseFile(): boolean {
  return storeMode === "file";
}

export async function listConversations(
  userId: string,
): Promise<Conversation[]> {
  if (shouldUseFile()) return fileListConversations(userId);
  if (!shouldUseSupabase()) {
    warnOnce();
    return memListConversations(userId);
  }
  const { data, error } = await supabaseService!
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .not("agent_id", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`listConversations: ${error.message}`);
  return (data ?? []).map(mapConversation);
}

export async function createConversation(
  userId: string,
  agentId: string,
  title?: string,
): Promise<Conversation> {
  if (shouldUseFile()) return fileCreateConversation(userId, agentId, title);
  if (!shouldUseSupabase()) {
    warnOnce();
    return memCreateConversation(userId, agentId, title);
  }
  const { data, error } = await supabaseService!
    .from("conversations")
    .insert({
      user_id: userId,
      agent_id: agentId,
      title: title ?? "Nuova conversazione",
      last_message_at: new Date().toISOString(),
      unread_count: 0,
    })
    .select()
    .single();
  if (error) throw new Error(`createConversation: ${error.message}`);
  return mapConversation(data);
}

export async function getConversation(
  id: string,
): Promise<Conversation | null> {
  if (shouldUseFile()) return fileGetConversation(id);
  if (!shouldUseSupabase()) return memGetConversation(id);
  const { data, error } = await supabaseService!
    .from("conversations")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data ? mapConversation(data) : null;
}

export async function listMessages(
  conversationId: string,
  limit = 50,
  cursor?: string,
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  if (shouldUseFile()) return fileListMessages(conversationId, limit);
  if (!shouldUseSupabase()) return memListMessages(conversationId, limit);
  let query = supabaseService!
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit + 1);
  if (cursor) {
    query = query.gt("created_at", cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`listMessages: ${error.message}`);
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore ? String(sliced[sliced.length - 1]?.created_at) : null;
  return {
    messages: sliced.map(mapMessage),
    nextCursor: next,
  };
}

export async function appendMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  toolCalls?: unknown,
): Promise<Message> {
  if (shouldUseFile()) return fileAppendMessage(conversationId, role, content, toolCalls);
  if (!shouldUseSupabase()) {
    return memAppendMessage(conversationId, role, content, toolCalls);
  }
  const { data, error } = await supabaseService!
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
      tool_calls: toolCalls ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`appendMessage: ${error.message}`);
  return mapMessage(data);
}

export async function touchConversation(
  id: string,
  preview: string,
  incrementUnread: boolean,
  opts?: { preserveTitle?: boolean },
): Promise<void> {
  if (shouldUseFile()) {
    await fileTouchConversation(id, preview, incrementUnread, opts);
    await emitTouchEvent(id, preview, incrementUnread);
    return;
  }
  if (!shouldUseSupabase()) {
    memTouchConversation(id, preview, incrementUnread, opts);
    await emitTouchEvent(id, preview, incrementUnread);
    return;
  }
  const fields: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
  };
  if (!opts?.preserveTitle) {
    fields.title = preview.slice(0, 40) || "Nuova conversazione";
  }
  if (incrementUnread) {
    const { data } = await supabaseService!
      .from("conversations")
      .select("unread_count")
      .eq("id", id)
      .single();
    fields.unread_count = (Number(data?.unread_count) || 0) + 1;
  }
  await supabaseService!
    .from("conversations")
    .update(fields)
    .eq("id", id);
  await emitTouchEvent(id, preview, incrementUnread);
}

async function emitTouchEvent(
  conversationId: string,
  preview: string,
  incrementUnread: boolean,
): Promise<void> {
  try {
    const conv = await getConversation(conversationId);
    if (!conv) return;
    eventBus.emitInbox({
      type: incrementUnread ? "message-appended" : "conversation-touched",
      userId: conv.userId,
      conversationId,
      agentId: conv.agentId,
      preview: preview.slice(0, 200),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[inbox-store] emitTouchEvent failed:", err);
  }
}

export async function resetUnread(id: string): Promise<void> {
  if (shouldUseFile()) {
    await fileResetUnread(id);
    return;
  }
  if (!shouldUseSupabase()) {
    memResetUnread(id);
    return;
  }
  await supabaseService!
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", id);
}

export async function deleteConversation(
  id: string,
  userId: string,
): Promise<boolean> {
  const conv = await getConversation(id);
  if (!conv || conv.userId !== userId) return false;

  if (shouldUseFile()) {
    return fileDeleteConversation(id);
  }
  if (!shouldUseSupabase()) {
    return memDeleteConversation(id);
  }
  // Messages vengono rimossi via FK cascade (migration 20260421_inbox_messages_table).
  const { error } = await supabaseService!
    .from("conversations")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`deleteConversation: ${error.message}`);
  return true;
}
