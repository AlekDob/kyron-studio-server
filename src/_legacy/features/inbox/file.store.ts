import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Conversation, Message } from "./types.js";

/**
 * Brain: 024-workflow-module — file-based persistence for Inbox.
 *
 * Stesso pattern del workflow file store: JSON su disco sotto
 * `~/.spaceship/inbox/` (override via SPACESHIP_DATA_DIR).
 * - conversations.json: array di tutte le conversation (con userId)
 * - messages/{convId}.json: array di messaggi per conversation
 *
 * Scelto sopra sqlite per: zero deps, ispezionabile a mano con cat/jq,
 * stesso pattern del workflow store. Se volumi diventano grandi → migrate sqlite.
 */

const BASE_DIR = resolve(
  process.env.SPACESHIP_DATA_DIR ?? `${process.env.HOME}/.spaceship`,
  "inbox",
);
const CONVS_PATH = resolve(BASE_DIR, "conversations.json");
const MESSAGES_DIR = resolve(BASE_DIR, "messages");

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function loadConversations(): Promise<Conversation[]> {
  if (!existsSync(CONVS_PATH)) return [];
  try {
    const raw = await readFile(CONVS_PATH, "utf8");
    return JSON.parse(raw) as Conversation[];
  } catch (err) {
    console.error("[inbox-file-store] read conversations failed:", err);
    return [];
  }
}

async function saveConversations(all: Conversation[]): Promise<void> {
  await ensureDir(BASE_DIR);
  await writeFile(CONVS_PATH, JSON.stringify(all, null, 2) + "\n", "utf8");
}

async function loadMessages(conversationId: string): Promise<Message[]> {
  const path = resolve(MESSAGES_DIR, `${conversationId}.json`);
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Message[];
  } catch {
    return [];
  }
}

async function saveMessages(conversationId: string, messages: Message[]): Promise<void> {
  await ensureDir(MESSAGES_DIR);
  const path = resolve(MESSAGES_DIR, `${conversationId}.json`);
  await writeFile(path, JSON.stringify(messages, null, 2) + "\n", "utf8");
}

// ── Public API (same signatures as memory.store) ───────────

export async function fileListConversations(userId: string): Promise<Conversation[]> {
  const all = await loadConversations();
  return all
    .filter((c) => c.userId === userId && c.agentId !== null)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, 100);
}

export async function fileCreateConversation(
  userId: string,
  agentId: string,
  title?: string,
): Promise<Conversation> {
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
  const all = await loadConversations();
  all.push(conv);
  await saveConversations(all);
  await saveMessages(conv.id, []);
  return conv;
}

export async function fileGetConversation(id: string): Promise<Conversation | null> {
  const all = await loadConversations();
  return all.find((c) => c.id === id) ?? null;
}

export async function fileListMessages(
  conversationId: string,
  limit: number,
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const all = await loadMessages(conversationId);
  const sliced = all.slice(0, limit);
  return { messages: sliced, nextCursor: null };
}

export async function fileAppendMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  toolCalls?: unknown,
): Promise<Message> {
  const msg: Message = {
    id: randomUUID(),
    conversationId,
    role,
    content,
    toolCalls: toolCalls ?? null,
    createdAt: new Date().toISOString(),
  };
  const existing = await loadMessages(conversationId);
  existing.push(msg);
  await saveMessages(conversationId, existing);
  return msg;
}

export async function fileTouchConversation(
  id: string,
  preview: string,
  incrementUnread: boolean,
  opts?: { preserveTitle?: boolean },
): Promise<void> {
  const all = await loadConversations();
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const conv = all[idx]!;
  const title = opts?.preserveTitle
    ? conv.title
    : preview.slice(0, 40) || conv.title;
  all[idx] = {
    ...conv,
    title,
    lastMessageAt: new Date().toISOString(),
    unreadCount: incrementUnread ? conv.unreadCount + 1 : conv.unreadCount,
  };
  await saveConversations(all);
}

export async function fileResetUnread(id: string): Promise<void> {
  const all = await loadConversations();
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx]!, unreadCount: 0 };
  await saveConversations(all);
}

export async function fileDeleteConversation(id: string): Promise<boolean> {
  const all = await loadConversations();
  const idx = all.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await saveConversations(all);
  const path = resolve(MESSAGES_DIR, `${id}.json`);
  if (existsSync(path)) {
    await rm(path, { force: true });
  }
  return true;
}
