import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pgClient } from "@/core/db/client.js";
import { resolveEmbeddingProvider } from "@/core/embeddings/index.js";
import { requireAnalystTenantCtx } from "./search-clients.tool.js";

/**
 * Analyst tool: search_brain_org
 * Vector search su brain_chunks filtrato per scope='org' (documenti org-wide,
 * NON scoped a clienti specifici). Stesso pattern pgClient.unsafe con parametri
 * bound di search-brain-scoped.
 */

interface ChunkRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  text: string;
  score: number;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export const searchBrainOrgTool = createTool({
  id: "search_brain_org",
  description:
    "Cerca nei documenti org-wide (scope='org') via RAG vector. Utile per domande su policy interne, " +
    "procedure, listini condivisi. NON include documenti scoped su clienti specifici.",
  inputSchema: z.object({
    query: z.string().min(2).max(500),
    topK: z.number().int().min(1).max(10).default(5),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        chunkId: z.string(),
        documentId: z.string(),
        documentTitle: z.string(),
        text: z.string(),
        score: z.number(),
      }),
    ),
  }),
  execute: async ({ context }) => {
    const tenantCtx = requireAnalystTenantCtx();
    const embedder = resolveEmbeddingProvider();
    const [queryVec] = await embedder.embedBatch([context.query]);
    if (!queryVec) {
      return { results: [] };
    }
    const vectorParam = toVectorLiteral(queryVec);

    const rows = (await pgClient.unsafe(
      `SELECT
         c.id AS chunk_id,
         c.document_id,
         d.title AS document_title,
         c.content AS text,
         1 - (c.embedding <=> $1::vector) AS score
       FROM brain_chunks c
       JOIN brain_documents d ON d.id = c.document_id
       WHERE c.org_id = $2::uuid
         AND c.scope = 'org'
         AND d.deleted_at IS NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT $3`,
      [vectorParam, tenantCtx.orgId, context.topK],
    )) as unknown as ChunkRow[];

    return {
      results: rows.map((r) => ({
        chunkId: r.chunk_id,
        documentId: r.document_id,
        documentTitle: r.document_title,
        text: r.text,
        score: Number(r.score),
      })),
    };
  },
});
