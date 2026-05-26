import type { WorkflowNode } from "../../types.js";
import type { ExecutionContext, NodeResult } from "../execute.js";

export async function executeIf(
  node: WorkflowNode,
  ctx: ExecutionContext,
): Promise<NodeResult> {
  if (node.config.type !== "if") {
    throw new Error("Config type mismatch");
  }

  const { condition, trueEdge, falseEdge } = node.config;
  const result = evaluateCondition(condition, ctx.variables);

  return {
    output: { condition, result },
    nextNodeIds: [result ? trueEdge : falseEdge],
  };
}

function evaluateCondition(
  condition: string,
  vars: Map<string, unknown>,
): boolean {
  const resolved = condition.replace(
    /\{\{(\w+(?:\.\w+)*)\}\}/g,
    (_match, path: string) => {
      const parts = path.split(".");
      let value: unknown = vars.get(parts[0]!);
      for (let i = 1; i < parts.length && value != null; i++) {
        value = (value as Record<string, unknown>)[parts[i]!];
      }
      return JSON.stringify(value ?? null);
    },
  );

  try {
    return Boolean(JSON.parse(resolved));
  } catch {
    return resolved.trim().length > 0 && resolved.trim() !== "false" && resolved.trim() !== "null";
  }
}
