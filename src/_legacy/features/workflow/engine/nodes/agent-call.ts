import { buildRegisteredAgent } from "@/core/agent-runtime/registry.js";
import { resolveForProcess } from "@/core/llm/resolver.js";
import type { WorkflowNode } from "../../types.js";
import type { ExecutionContext, NodeResult } from "../execute.js";

export async function executeAgentCall(
  node: WorkflowNode,
  ctx: ExecutionContext,
  defaultNext: string[],
): Promise<NodeResult> {
  if (node.config.type !== "agent-call") {
    throw new Error("Config type mismatch");
  }

  const { agentId, promptTemplate, maxSteps } = node.config;

  const prompt = interpolateTemplate(promptTemplate, ctx.variables);

  const model = await resolveForProcess(ctx.orgId, agentId, "_default");
  if (!model) {
    throw new Error(`Nessun LLM configurato per agente "${agentId}"`);
  }

  const agent = buildRegisteredAgent(agentId, model);
  const result = await agent.generate(
    [{ role: "user", content: prompt }],
    { maxSteps },
  );

  return {
    output: { text: result.text, agentId },
    nextNodeIds: defaultNext,
  };
}

function interpolateTemplate(
  template: string,
  vars: Map<string, unknown>,
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split(".");
    let value: unknown = vars.get(parts[0]!);
    for (let i = 1; i < parts.length && value != null; i++) {
      value = (value as Record<string, unknown>)[parts[i]!];
    }
    return value != null ? String(value) : "";
  });
}
