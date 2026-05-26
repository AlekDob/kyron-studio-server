import { z } from "zod";

// Brain: 004-brain-module — zod schemas per Brain module

export const sourceTypeSchema = z.enum([
  "pdf",
  "docx",
  "md",
  "txt",
  "agent_memory",
]);

export const brainDocumentSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  title: z.string(),
  sourceType: sourceTypeSchema,
  sourceMetadata: z.record(z.unknown()).default({}),
  createdByUserId: z.string().uuid().nullable(),
  createdByAgentId: z.string().nullable(),
  isEphemeral: z.boolean().default(false),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});

export const brainChunkSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  orgId: z.string().uuid(),
  chunkIndex: z.number().int(),
  content: z.string(),
  modelId: z.string(),
  modelVersion: z.string(),
  dimensions: z.number().int(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
});

export const searchResultSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  documentTitle: z.string(),
  content: z.string(),
  score: z.number(),
  sourceType: sourceTypeSchema,
});

export const uploadInputSchema = z.object({
  title: z.string().min(1),
  sourceType: sourceTypeSchema,
});

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  sourceTypes: z.string().optional(),
});

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type BrainDocument = z.infer<typeof brainDocumentSchema>;
export type BrainChunk = z.infer<typeof brainChunkSchema>;
export type BrainSearchResult = z.infer<typeof searchResultSchema>;
