import { randomUUID } from "node:crypto";
import type { Conversation, Message } from "./types.js";

/**
 * In-memory fallback when Supabase is not configured.
 * Mirrors the runtime's dev-agent pattern: local dev must work end-to-end
 * without external infra. Data is lost on server restart.
 *
 * Brain: 002-inbox-module - dev-mode parity with production API surface.
 */

const conversations = new Map<string, Conversation>();
const messagesByConv = new Map<string, Message[]>();

export function memListConversations(userId: string): Conversation[] {
  return [...conversations.values()]
    .filter((c) => c.userId === userId && c.agentId !== null)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, 100);
}

export function memCreateConversation(
  userId: string,
  agentId: string,
  title?: string,
): Conversation {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: randomUUID(),
    userId,
    agentId,
    title: title ?? "Nuova conversazione",
    lastMessageAt: now,
    unreadCount: 0,
    createdAt: now,
  };
  conversations.set(conv.id, conv);
  messagesByConv.set(conv.id, []);
  return conv;
}

export function memGetConversation(id: string): Conversation | null {
  return conversations.get(id) ?? null;
}

export function memListMessages(
  conversationId: string,
  limit: number,
): { messages: Message[]; nextCursor: string | null } {
  const all = messagesByConv.get(conversationId) ?? [];
  const sliced = all.slice(0, limit);
  return { messages: sliced, nextCursor: null };
}

export function memAppendMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  toolCalls?: unknown,
): Message {
  const msg: Message = {
    id: randomUUID(),
    conversationId,
    role,
    content,
    toolCalls: toolCalls ?? null,
    createdAt: new Date().toISOString(),
  };
  const existing = messagesByConv.get(conversationId) ?? [];
  existing.push(msg);
  messagesByConv.set(conversationId, existing);
  return msg;
}

export function memTouchConversation(
  id: string,
  preview: string,
  incrementUnread: boolean,
  opts?: { preserveTitle?: boolean },
): void {
  const conv = conversations.get(id);
  if (!conv) return;
  const title = opts?.preserveTitle
    ? conv.title
    : preview.slice(0, 40) || conv.title;
  conversations.set(id, {
    ...conv,
    title,
    lastMessageAt: new Date().toISOString(),
    unreadCount: incrementUnread ? conv.unreadCount + 1 : conv.unreadCount,
  });
}

export function memResetUnread(id: string): void {
  const conv = conversations.get(id);
  if (!conv) return;
  conversations.set(id, { ...conv, unreadCount: 0 });
}

export function memDeleteConversation(id: string): boolean {
  const existed = conversations.delete(id);
  messagesByConv.delete(id);
  return existed;
}
