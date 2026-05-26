import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStore } from "../store/index.js";

export const listWorkflowsTool = createTool({
  id: "list_workflows",
  description: "Elenca tutti i workflow dell'organizzazione.",
  inputSchema: z.object({
    orgId: z.string().default("org-dev"),
  }),
  outputSchema: z.object({
    count: z.number(),
    workflows: z.array(z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      nodeCount: z.number(),
      version: z.number(),
    })),
  }),
  execute: async ({ context }) => {
    const store = getWorkflowStore();
    const all = await store.list(context.orgId);
    return {
      count: all.length,
      workflows: all.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        nodeCount: w.nodes.length,
        version: w.version,
      })),
    };
  },
});
