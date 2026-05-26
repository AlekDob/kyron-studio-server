// Brain: dev-mode-requires-memory-fallback
// In-memory + JSON disk persistence per dev senza Supabase/pgvector.

import type { ChunkRecord, SearchResult, VectorStore } from "./store.js";
import { loadJsonFile, saveJsonFile } from "@/features/brain/disk-store.js";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function createMemoryVectorStore(): VectorStore {
  const chunks = new Map<string, ChunkRecord>();
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    const stored = await loadJsonFile<ChunkRecord[]>("chunks", []);
    for (const c of stored) chunks.set(c.id, c);
    loaded = true;
  }

  async function persist(): Promise<void> {
    await saveJsonFile("chunks", [...chunks.values()]);
  }

  return {
    async upsert(records: ChunkRecord[]): Promise<void> {
      await ensureLoaded();
      for (const r of records) chunks.set(r.id, r);
      await persist();
    },

    async query(
      orgId: string,
      embedding: number[],
      limit: number,
    ): Promise<SearchResult[]> {
      await ensureLoaded();
      const orgChunks = [...chunks.values()].filter((c) => c.orgId === orgId);
      const scored = orgChunks.map((c) => ({
        chunkId: c.id,
        documentId: c.documentId,
        content: c.content,
        score: cosineSimilarity(embedding, c.embedding),
        metadata: c.metadata,
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    },

    async listByDocument(documentId: string): Promise<ChunkRecord[]> {
      await ensureLoaded();
      return [...chunks.values()]
        .filter((c) => c.documentId === documentId)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
    },

    async deleteByDocument(documentId: string): Promise<void> {
      await ensureLoaded();
      let changed = false;
      for (const [id, c] of chunks) {
        if (c.documentId === documentId) {
          chunks.delete(id);
          changed = true;
        }
      }
      if (changed) await persist();
    },
  };
}
