import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients.js";

export const brainSourceTypeEnum = pgEnum("brain_source_type", [
  "pdf",
  "docx",
  "md",
  "txt",
  "html",
  "note",
  "memory",
]);

export const brainScopeEnum = pgEnum("brain_scope", ["org", "client"]);

export const brainDocuments = pgTable(
  "brain_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    scope: brainScopeEnum("scope").notNull().default("org"),
    title: text("title").notNull(),
    sourceType: brainSourceTypeEnum("source_type").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    storageKey: text("storage_key"),
    ephemeral: boolean("ephemeral").notNull().default(false),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgScope: index("idx_brain_org_scope").on(t.orgId, t.scope),
    clientScope: index("idx_brain_client").on(t.clientId).where(sql`${t.clientId} IS NOT NULL`),
  }),
);

export const brainChunks = pgTable(
  "brain_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => brainDocuments.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    clientId: uuid("client_id"),
    scope: brainScopeEnum("scope").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docIdx: index("idx_chunks_document").on(t.documentId),
    orgScopeIdx: index("idx_chunks_org_scope").on(t.orgId, t.scope),
  }),
);

export type BrainDocument = typeof brainDocuments.$inferSelect;
export type BrainChunk = typeof brainChunks.$inferSelect;
