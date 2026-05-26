import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { authMiddleware } from "@/core/auth/middleware.js";
import { resolveEmbeddingProvider } from "@/core/embeddings/index.js";
import { resolveVectorStore } from "@/core/vector-store/index.js";
import { createDocument, listDocuments, deleteDocument, getDocument } from "./store.js";
import { parseDocument, chunkText } from "./ingestion/index.js";
import { searchQuerySchema, sourceTypeSchema } from "./types.js";
import type { SourceType } from "./types.js";

type AuthedEnv = { Variables: { userId: string } };

export const brainRoute = new Hono<AuthedEnv>();

brainRoute.use("*", authMiddleware);

brainRoute.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  const title = String(body.title || "Documento senza titolo");

  if (!(file instanceof File)) {
    return c.json({ error: "File richiesto nel campo 'file'" }, 400);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const sourceType = inferSourceType(ext);
  if (!sourceType) {
    return c.json({ error: `Tipo file non supportato: .${ext}` }, 400);
  }

  const userId = c.get("userId");
  const orgId = "demo-org";

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    return c.json({ error: "File vuoto: nessun contenuto da processare" }, 400);
  }

  let text: string;
  try {
    text = await parseDocument(buffer, sourceType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parsing failed";
    return c.json({ error: msg }, 422);
  }

  if (!text) {
    return c.json({ error: "Nessun testo estratto dal documento" }, 400);
  }

  const doc = await createDocument(orgId, title, sourceType, userId, null, false);
  const chunks = chunkText(text);

  const embedder = resolveEmbeddingProvider();
  const vectorStore = resolveVectorStore();
  const embeddings = await embedder.embedBatch(chunks.map((ch) => ch.content));

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
    metadata: { originalFilename: file.name },
    createdAt: new Date().toISOString(),
  }));

  await vectorStore.upsert(records);

  return c.json({ documentId: doc.id, chunksCount: chunks.length }, 201);
});

brainRoute.get("/documents", async (c) => {
  const orgId = "demo-org";
  const sourceType = c.req.query("source_type") as SourceType | undefined;
  const limit = Number(c.req.query("limit") ?? 20);

  if (sourceType) {
    const valid = sourceTypeSchema.safeParse(sourceType);
    if (!valid.success) {
      return c.json({ error: "source_type non valido" }, 400);
    }
  }

  const documents = await listDocuments(orgId, sourceType, limit);
  return c.json({ documents });
});

brainRoute.get("/search", async (c) => {
  const parsed = searchQuerySchema.safeParse({
    q: c.req.query("q"),
    limit: c.req.query("limit"),
    sourceTypes: c.req.query("source_types"),
  });
  if (!parsed.success) {
    return c.json({ error: "Query 'q' richiesta", issues: parsed.error.issues }, 400);
  }

  const orgId = "demo-org";
  const embedder = resolveEmbeddingProvider();
  const vectorStore = resolveVectorStore();

  const queryEmbedding = await embedder.embed(parsed.data.q);
  const raw = await vectorStore.query(orgId, queryEmbedding, parsed.data.limit);

  const docs = await listDocuments(orgId, undefined, 100);
  const docMap = new Map(docs.map((d) => [d.id, d]));

  const results = raw.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentTitle: docMap.get(r.documentId)?.title ?? "Sconosciuto",
    content: r.content,
    score: Math.round(r.score * 1000) / 1000,
    sourceType: docMap.get(r.documentId)?.sourceType ?? "unknown",
  }));

  return c.json({ results });
});

brainRoute.get("/documents/:id/chunks", async (c) => {
  const id = c.req.param("id");
  const doc = await getDocument(id);
  if (!doc) return c.json({ error: "Documento non trovato" }, 404);

  const vectorStore = resolveVectorStore();
  const chunks = await vectorStore.listByDocument(id);

  return c.json({
    document: {
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      isEphemeral: doc.isEphemeral,
      createdAt: doc.createdAt,
      createdByAgentId: doc.createdByAgentId,
    },
    chunks: chunks.map((c) => ({
      index: c.chunkIndex,
      content: c.content,
    })),
  });
});

brainRoute.delete("/documents/:id", async (c) => {
  const id = c.req.param("id");
  const doc = await getDocument(id);
  if (!doc) return c.json({ error: "Documento non trovato" }, 404);

  const vectorStore = resolveVectorStore();
  await vectorStore.deleteByDocument(id);
  await deleteDocument(id);

  return c.json({ deleted: true });
});

function inferSourceType(ext: string): SourceType | null {
  switch (ext) {
    case "pdf": return "pdf";
    case "docx": return "docx";
    case "md": return "md";
    case "txt": return "txt";
    default: return null;
  }
}
