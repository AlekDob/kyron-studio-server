// Brain: 004-brain-module — HITL se permanent, silenzioso se ephemeral

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveEmbeddingProvider } from "@/core/embeddings/index.js";
import { resolveVectorStore } from "@/core/vector-store/index.js";
import { createDocument } from "../store.js";
import { chunkText } from "../ingestion/chunker.js";

export const addToBrainTool = createTool({
  id: "add_to_brain",
  description:
    "Salva una informazione nella knowledge base aziendale (Brain). Usa permanent=true per fatti verificati e duraturi (richiede approvazione utente), permanent=false per note temporanee di sessione (30gg TTL, nessuna approvazione).",
  inputSchema: z.object({
    content: z.string().describe("Il contenuto da salvare"),
    title: z.string().describe("Titolo descrittivo del contenuto"),
    permanent: z.boolean().default(false),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    documentId: z.string(),
    chunksCount: z.number(),
    needsApproval: z.boolean(),
  }),
  execute: async ({ context }) => {
    const orgId = "demo-org";
    const isEphemeral = !context.permanent;

    const doc = await createDocument(
      orgId,
      context.title,
      "agent_memory",
      null,
      "brain",
      isEphemeral,
    );

    const chunks = chunkText(context.content);
    const embedder = resolveEmbeddingProvider();
    const vectorStore = resolveVectorStore();

    const embeddings = await embedder.embedBatch(
      chunks.map((c) => c.content),
    );

    const records = chunks.map((chunk, i) => ({
      id: randomUUID(),
      documentId: doc.id,
      orgId,
      chunkIndex: chunk.index,
      content: chunk.content,
      embedding: embeddings[i],
      modelId: embedder.modelId,
      modelVersion: embedder.modelVersion,
      dimensions: embedder.dimensions,
      metadata: {},
      createdAt: new Date().toISOString(),
    }));

    await vectorStore.upsert(records);

    return {
      success: true,
      documentId: doc.id,
      chunksCount: chunks.length,
      needsApproval: context.permanent,
    };
  },
});
