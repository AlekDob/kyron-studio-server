// Brain: 004-brain-module — vector store resolver with dev-mode fallback

import { supabaseService } from "@/core/supabase/client.js";
import type { VectorStore } from "./store.js";
import { createPgVectorStore } from "./pgvector.store.js";
import { createMemoryVectorStore } from "./memory.store.js";

export type { VectorStore, ChunkRecord, SearchResult } from "./store.js";

let cached: VectorStore | null = null;
let warnedMemory = false;

export function resolveVectorStore(): VectorStore {
  if (cached) return cached;

  if (supabaseService) {
    cached = createPgVectorStore();
    console.log("[vector-store] using pgvector (Supabase)");
  } else {
    if (!warnedMemory) {
      warnedMemory = true;
      console.warn("[vector-store] Supabase not configured - using in-memory fallback");
    }
    cached = createMemoryVectorStore();
  }

  return cached;
}
