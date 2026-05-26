import { Hono } from "hono";
import {
  authMiddleware,
  authContextFrom,
  type AuthedVars,
} from "@/core/auth/middleware.js";
import {
  parseDocument,
  chunkText,
} from "@/features/brain/ingestion/index.js";
import { resolveEmbeddingProvider } from "@/core/embeddings/index.js";
import { resolveStorage } from "@/core/storage/index.js";
import {
  insertClientDocument,
  listClientDocuments,
  softDeleteClientDocument,
  type ClientDocumentSourceType,
} from "./store/documents.store.js";
import { badRequest, notFound, serverError } from "./errors.js";

type Env = { Variables: AuthedVars };

export const documentsRoute = new Hono<Env>();

documentsRoute.use("*", authMiddleware);

type ParserSourceType = "pdf" | "docx" | "md" | "txt";

function inferSourceType(ext: string): ParserSourceType | null {
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "md") return "md";
  if (ext === "txt") return "txt";
  return null;
}

documentsRoute.post("/:clientId/documents/upload", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const body = await c.req.parseBody();
    const file = body.file;
    const title = String(body.title || "Documento senza titolo");

    if (!(file instanceof File)) {
      return badRequest(c, "File richiesto nel campo 'file'");
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const sourceType = inferSourceType(ext);
    if (!sourceType) return badRequest(c, `Tipo file non supportato: .${ext}`);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuffer));
    if (buffer.byteLength === 0) return badRequest(c, "File vuoto");

    let text: string;
    try {
      text = await parseDocument(buffer, sourceType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Parsing fallito";
      return c.json({ code: "parse_error", message: msg }, 422);
    }
    if (!text) return badRequest(c, "Nessun testo estratto dal documento");

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return badRequest(c, "Nessun chunk estratto dal documento");
    }

    const embedder = resolveEmbeddingProvider();
    const embeddings = await embedder.embedBatch(chunks.map((ch) => ch.content));

    // Save binary to storage for preview/download.
    const storage = resolveStorage();
    const storageKey = `clients/${clientId}/docs/${Date.now()}-${file.name}`;
    await storage.upload(
      storageKey,
      buffer,
      file.type || "application/octet-stream",
    );

    const ctx = authContextFrom(c);
    const doc = await insertClientDocument(ctx, {
      clientId,
      title,
      sourceType: sourceType as ClientDocumentSourceType,
      storageKey,
      chunks: chunks.map((ch, i) => ({
        content: ch.content,
        embedding: embeddings[i] ?? [],
        chunkIndex: ch.index,
      })),
    });
    if (!doc) return notFound(c, "Cliente", clientId);

    return c.json(doc, 201);
  } catch (err) {
    return serverError(c, err);
  }
});

documentsRoute.get("/:clientId/documents", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const items = await listClientDocuments(authContextFrom(c), clientId);
    return c.json({ items });
  } catch (err) {
    return serverError(c, err);
  }
});

documentsRoute.delete("/:clientId/documents/:docId", async (c) => {
  try {
    const clientId = c.req.param("clientId");
    const docId = c.req.param("docId");
    const ok = await softDeleteClientDocument(
      authContextFrom(c),
      clientId,
      docId,
    );
    if (!ok) return notFound(c, "Documento", docId);
    return c.body(null, 204);
  } catch (err) {
    return serverError(c, err);
  }
});
