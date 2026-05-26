import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStore } from "../store/index.js";
import { compile } from "../engine/compile.js";

export const validateWorkflowTool = createTool({
  id: "validate_workflow",
  description:
    "Valida un workflow: controlla che il grafo sia valido, che ci sia un trigger e nessun ciclo.",
  inputSchema: z.object({
    workflowId: z.string().uuid().describe("ID del workflow da validare"),
    orgId: z.string().default("org-dev"),
  }),
  outputSchema: z.object({
    valid: z.boolean(),
    errors: z.array(z.object({
      nodeId: z.string().optional(),
      message: z.string(),
    })),
  }),
  execute: async ({ context }) => {
    const store = getWorkflowStore();
    const wf = await store.get(context.orgId, context.workflowId);
    if (!wf) {
      return { valid: false, errors: [{ message: "Workflow non trovato" }] };
    }
    const result = compile(wf);
    return { valid: result.ok, errors: result.errors };
  },
});
