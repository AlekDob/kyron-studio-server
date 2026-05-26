// Brain: 004-brain-module — pgvector su Supabase, HNSW cosine

import { supabaseService } from "@/core/supabase/client.js";
import type { ChunkRecord, SearchResult, VectorStore } from "./store.js";

function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function createPgVectorStore(): VectorStore {
  if (!supabaseService) {
    throw new Error("Supabase required for pgvector store");
  }
  const sb = supabaseService;

  return {
    async upsert(chunks: ChunkRecord[]): Promise<void> {
      const rows = chunks.map((c) => ({
        id: c.id,
        document_id: c.documentId,
        org_id: c.orgId,
        chunk_index: c.chunkIndex,
        content: c.content,
        embedding: toPgVector(c.embedding),
        model_id: c.modelId,
        model_version: c.modelVersion,
        dimensions: c.dimensions,
        metadata: c.metadata,
      }));
      const { error } = await sb.from("brain_chunks").upsert(rows);
      if (error) throw new Error(`pgvector upsert: ${error.message}`);
    },

    async query(
      orgId: string,
      embedding: number[],
      limit: number,
    ): Promise<SearchResult[]> {
      const { data, error } = await sb.rpc("brain_search", {
        query_embedding: toPgVector(embedding),
        query_org_id: orgId,
        match_count: limit,
      });
      if (error) throw new Error(`pgvector query: ${error.message}`);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        chunkId: String(r.id),
        documentId: String(r.document_id),
        content: String(r.content),
        score: Number(r.similarity),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      }));
    },

    async listByDocument(documentId: string): Promise<ChunkRecord[]> {
      const { data, error } = await sb
        .from("brain_chunks")
        .select("*")
        .eq("document_id", documentId)
        .order("chunk_index", { ascending: true });
      if (error) throw new Error(`pgvector list: ${error.message}`);
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        documentId: String(r.document_id),
        orgId: String(r.org_id),
        chunkIndex: Number(r.chunk_index),
        content: String(r.content),
        embedding: [],
        modelId: String(r.model_id),
        modelVersion: String(r.model_version),
        dimensions: Number(r.dimensions),
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        createdAt: String(r.created_at),
      }));
    },

    async deleteByDocument(documentId: string): Promise<void> {
      const { error } = await sb
        .from("brain_chunks")
        .delete()
        .eq("document_id", documentId);
      if (error) throw new Error(`pgvector delete: ${error.message}`);
    },
  };
}
