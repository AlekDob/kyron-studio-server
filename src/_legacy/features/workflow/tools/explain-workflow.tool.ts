import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getWorkflowStore } from "../store/index.js";

export const explainWorkflowTool = createTool({
  id: "explain_workflow",
  description:
    "Spiega in linguaggio naturale cosa fa un workflow. Legge la struttura e genera una descrizione step-by-step.",
  inputSchema: z.object({
    workflowId: z.string().uuid().describe("ID del workflow da spiegare"),
    orgId: z.string().default("org-dev"),
  }),
  outputSchema: z.object({
    name: z.string(),
    summary: z.string(),
    steps: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const store = getWorkflowStore();
    const wf = await store.get(context.orgId, context.workflowId);
    if (!wf) {
      return { name: "N/A", summary: "Workflow non trovato", steps: [] };
    }

    const steps = wf.nodes.map((node, i) => {
      const prefix = `${i + 1}.`;
      switch (node.config.type) {
        case "trigger":
          return `${prefix} Trigger: ${node.label} (${node.config.triggerType})`;
        case "agent-call":
          return `${prefix} Chiama agente "${node.config.agentId}": ${node.config.promptTemplate.slice(0, 80)}`;
        case "tool-call":
          return `${prefix} Esegue tool "${node.config.toolName}"`;
        case "if":
          return `${prefix} Condizione: ${node.config.condition}`;
        case "branch":
          return `${prefix} Diramazione con ${node.config.branches.length} rami`;
        case "loop":
          return `${prefix} Ciclo su "${node.config.arrayExpression}"`;
        case "merge":
          return `${prefix} Merge dei rami paralleli`;
      }
    });

    return {
      name: wf.name,
      summary: wf.description || `Workflow "${wf.name}" con ${wf.nodes.length} step`,
      steps,
    };
  },
});
