import { and, desc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  brainDocuments,
  brainChunks,
  clients,
  type BrainDocument,
} from "@/core/db/schema/index.js";
import { txWithTenant, type TenantContext } from "@/core/db/client.js";

export type ClientDocumentSourceType =
  | "pdf"
  | "docx"
  | "md"
  | "txt"
  | "html"
  | "note"
  | "memory";

export type DocumentInsertInput = {
  clientId: string;
  title: string;
  sourceType: ClientDocumentSourceType;
  storageKey: string | null;
  chunks: Array<{ content: string; embedding: number[]; chunkIndex: number }>;
};

export async function insertClientDocument(
  ctx: TenantContext,
  input: DocumentInsertInput,
): Promise<BrainDocument | null> {
  return txWithTenant(ctx, async (tx) => {
    // Verify cliente exists (RLS enforces org boundary).
    const clientRow = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (clientRow.length === 0) return null;

    const [doc] = await tx
      .insert(brainDocuments)
      .values({
        orgId: ctx.orgId,
        clientId: input.clientId,
        scope: "client",
        title: input.title,
        sourceType: input.sourceType,
        uploadedBy: ctx.userId,
        storageKey: input.storageKey,
        ephemeral: false,
        metadata: {},
      })
      .returning();

    if (input.chunks.length > 0) {
      const chunkRows = input.chunks.map((ch) => ({
        id: randomUUID(),
        documentId: doc.id,
        orgId: ctx.orgId,
        clientId: input.clientId,
        scope: "client" as const,
        chunkIndex: ch.chunkIndex,
        content: ch.content,
        embedding: ch.embedding,
        metadata: {},
      }));
      await tx.insert(brainChunks).values(chunkRows);
    }

    return doc;
  });
}

export async function listClientDocuments(
  ctx: TenantContext,
  clientId: string,
): Promise<BrainDocument[]> {
  return txWithTenant(ctx, async (tx) => {
    return tx
      .select()
      .from(brainDocuments)
      .where(
        and(
          eq(brainDocuments.clientId, clientId),
          eq(brainDocuments.scope, "client"),
          isNull(brainDocuments.deletedAt),
        ),
      )
      .orderBy(desc(brainDocuments.createdAt));
  });
}

export async function softDeleteClientDocument(
  ctx: TenantContext,
  clientId: string,
  docId: string,
): Promise<boolean> {
  return txWithTenant(ctx, async (tx) => {
    const rows = await tx
      .update(brainDocuments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(brainDocuments.id, docId),
          eq(brainDocuments.clientId, clientId),
          isNull(brainDocuments.deletedAt),
        ),
      )
      .returning({ id: brainDocuments.id });
    return rows.length > 0;
  });
}
