import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStore } from "../store/index.js";
import { workflowNodeSchema, workflowEdgeSchema } from "../types.js";

export const createWorkflowTool = createTool({
  id: "create_workflow",
  description:
    "Crea un nuovo workflow. L'agente usa questo tool quando l'utente descrive un'automazione da costruire. Genera i nodi e le connessioni del grafo.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Nome del workflow"),
    description: z.string().default("").describe("Descrizione breve"),
    tags: z.array(z.string()).default([]).describe("Tag liberi lowercase"),
    nodes: z.array(workflowNodeSchema).min(1).describe("Nodi del grafo"),
    edges: z.array(workflowEdgeSchema).describe("Connessioni tra nodi"),
    orgId: z.string().default("org-dev"),
    createdBy: z.string().default("astro-engineer"),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    nodeCount: z.number(),
  }),
  execute: async ({ context }) => {
    const store = getWorkflowStore();
    const wf = await store.save({
      orgId: context.orgId,
      name: context.name,
      description: context.description,
      tags: context.tags,
      status: "draft",
      nodes: context.nodes,
      edges: context.edges,
      createdBy: context.createdBy,
    });
    return { id: wf.id, name: wf.name, nodeCount: wf.nodes.length };
  },
});
