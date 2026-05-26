import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStore } from "../store/index.js";
import { workflowNodeSchema, workflowEdgeSchema } from "../types.js";

export const updateWorkflowTool = createTool({
  id: "update_workflow",
  description:
    "Aggiorna un workflow esistente. Usa per modificare nodi, connessioni, nome o descrizione.",
  inputSchema: z.object({
    workflowId: z.string().uuid().describe("ID del workflow da aggiornare"),
    orgId: z.string().default("org-dev"),
    name: z.string().optional(),
    description: z.string().optional(),
    nodes: z.array(workflowNodeSchema).optional(),
    edges: z.array(workflowEdgeSchema).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number(),
  }),
  execute: async ({ context }) => {
    const store = getWorkflowStore();
    const patch: Record<string, unknown> = {};
    if (context.name !== undefined) patch.name = context.name;
    if (context.description !== undefined) patch.description = context.description;
    if (context.nodes !== undefined) patch.nodes = context.nodes;
    if (context.edges !== undefined) patch.edges = context.edges;

    const updated = await store.update(context.orgId, context.workflowId, patch);
    return { id: updated.id, name: updated.name, version: updated.version };
  },
});
