import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pgClient } from "@/core/db/client.js";
import { resolveEmbeddingProvider } from "@/core/embeddings/index.js";
import { currentClientScopedContext } from "../scoped-context.js";

/**
 * Brain: clients-specialist-search-scoped
 * Vector search su brain_chunks filtrato per client_id + scope='client'.
 * Il vector literal e' generato server-side da embedBatch (modello locale), non
 * input utente: lo passiamo come parametro bound con cast esplicito a ::vector.
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

export const searchBrainScopedTool = createTool({
  id: "search_brain_scoped",
  description:
    "Cerca nei documenti caricati nella cartella di QUESTO cliente. Usalo per rispondere a domande " +
    "specifiche basate sui contenuti dei PDF/DOCX del cliente. Cita sempre il documento sorgente.",
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
    const { orgId, clientId } = currentClientScopedContext();
    const embedder = resolveEmbeddingProvider();
    const [queryVec] = await embedder.embedBatch([context.query]);
    if (!queryVec) {
      return { results: [] };
    }

    const vectorParam = toVectorLiteral(queryVec);

    const rows = (await pgClient.unsafe(
      `
      SELECT
        c.id AS chunk_id,
        c.document_id,
        d.title AS document_title,
        c.content AS text,
        1 - (c.embedding <=> $1::vector) AS score
      FROM brain_chunks c
      JOIN brain_documents d ON d.id = c.document_id
      WHERE c.org_id = $2::uuid
        AND c.client_id = $3::uuid
        AND c.scope = 'client'
        AND d.deleted_at IS NULL
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4
      `,
      [vectorParam, orgId, clientId, context.topK],
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
