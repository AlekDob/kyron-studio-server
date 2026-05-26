import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listDocuments } from "../store.js";
import { sourceTypeSchema } from "../types.js";

export const listSourcesTool = createTool({
  id: "list_sources",
  description:
    "Elenca i documenti presenti nella knowledge base aziendale (Brain). Utile per sapere cosa e' stato caricato e da chi.",
  inputSchema: z.object({
    sourceType: sourceTypeSchema.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  outputSchema: z.object({
    documents: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        sourceType: z.string(),
        isEphemeral: z.boolean(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async ({ context }) => {
    const orgId = "demo-org";
    const docs = await listDocuments(orgId, context.sourceType, context.limit);
    return {
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        sourceType: d.sourceType,
        isEphemeral: d.isEphemeral,
        createdAt: d.createdAt,
      })),
    };
  },
});
