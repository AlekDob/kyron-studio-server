// Brain: 004-brain-module — tool trasversale, disponibile a TUTTI gli agenti

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { resolveEmbeddingProvider } from "@/core/embeddings/index.js";
import { resolveVectorStore } from "@/core/vector-store/index.js";
import { listDocuments } from "../store.js";

export const searchBrainTool = createTool({
  id: "search_brain",
  description:
    "Cerca nella knowledge base aziendale (Brain). Usa questo tool quando l'utente pone una domanda che potrebbe avere risposta nei documenti caricati (policy, manuali, procedure, decisioni passate).",
  inputSchema: z.object({
    query: z.string().describe("La domanda o query di ricerca"),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        documentTitle: z.string(),
        content: z.string(),
        score: z.number(),
        sourceType: z.string(),
      }),
    ),
  }),
  execute: async ({ context }) => {
    const orgId = "demo-org";
    const embedder = resolveEmbeddingProvider();
    const vectorStore = resolveVectorStore();

    const queryEmbedding = await embedder.embed(context.query);
    const raw = await vectorStore.query(orgId, queryEmbedding, context.limit);

    const docs = await listDocuments(orgId);
    const docMap = new Map(docs.map((d) => [d.id, d]));

    const results = raw.map((r) => ({
      documentTitle: docMap.get(r.documentId)?.title ?? "Sconosciuto",
      content: r.content,
      score: Math.round(r.score * 1000) / 1000,
      sourceType: docMap.get(r.documentId)?.sourceType ?? "unknown",
    }));

    return { results };
  },
});
