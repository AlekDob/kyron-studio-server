import { randomUUID } from "node:crypto";
import type { BrainDocument, SourceType } from "./types.js";
import { loadJsonFile, saveJsonFile } from "./disk-store.js";

/**
 * In-memory + JSON disk persistence per dev senza Supabase.
 * I dati sopravvivono al restart del server (data/brain-documents.json).
 *
 * Brain: 004-brain-module
 * Brain: dev-mode-requires-memory-fallback
 */

const documents = new Map<string, BrainDocument>();
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const stored = await loadJsonFile<BrainDocument[]>("documents", []);
  for (const doc of stored) documents.set(doc.id, doc);
  loaded = true;
}

async function persist(): Promise<void> {
  await saveJsonFile("documents", [...documents.values()]);
}

export async function memCreateDocument(
  orgId: string,
  title: string,
  sourceType: SourceType,
  userId: string | null,
  agentId: string | null,
  isEphemeral: boolean,
): Promise<BrainDocument> {
  await ensureLoaded();
  const now = new Date().toISOString();
  const ttlDays = isEphemeral ? 30 : null;
  const doc: BrainDocument = {
    id: randomUUID(),
    orgId,
    title,
    sourceType,
    sourceMetadata: {},
    createdByUserId: userId,
    createdByAgentId: agentId,
    isEphemeral,
    expiresAt: ttlDays
      ? new Date(Date.now() + ttlDays * 86400_000).toISOString()
      : null,
    createdAt: now,
  };
  documents.set(doc.id, doc);
  await persist();
  return doc;
}

export async function memListDocuments(
  orgId: string,
  sourceType?: SourceType,
  limit = 20,
): Promise<BrainDocument[]> {
  await ensureLoaded();
  let docs = [...documents.values()].filter((d) => d.orgId === orgId);
  if (sourceType) docs = docs.filter((d) => d.sourceType === sourceType);
  return docs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function memGetDocument(id: string): Promise<BrainDocument | null> {
  await ensureLoaded();
  return documents.get(id) ?? null;
}

export async function memDeleteDocument(id: string): Promise<boolean> {
  await ensureLoaded();
  const ok = documents.delete(id);
  if (ok) await persist();
  return ok;
}
