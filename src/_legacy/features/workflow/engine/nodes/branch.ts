import type { WorkflowNode } from "../../types.js";
import type { ExecutionContext, NodeResult } from "../execute.js";

export async function executeBranch(
  node: WorkflowNode,
  ctx: ExecutionContext,
): Promise<NodeResult> {
  if (node.config.type !== "branch") {
    throw new Error("Config type mismatch");
  }

  const { branches, defaultEdge } = node.config;

  for (const branch of branches) {
    const value = resolveVariable(branch.condition, ctx.variables);
    if (isTruthy(value)) {
      return {
        output: { matched: branch.label, condition: branch.condition },
        nextNodeIds: [branch.edgeId],
      };
    }
  }

  if (defaultEdge) {
    return {
      output: { matched: "default" },
      nextNodeIds: [defaultEdge],
    };
  }

  return { output: { matched: null }, nextNodeIds: [] };
}

function resolveVariable(
  expr: string,
  vars: Map<string, unknown>,
): unknown {
  const match = expr.match(/^\{\{(\w+(?:\.\w+)*)\}\}$/);
  if (!match) return expr;
  const parts = match[1]!.split(".");
  let value: unknown = vars.get(parts[0]!);
  for (let i = 1; i < parts.length && value != null; i++) {
    value = (value as Record<string, unknown>)[parts[i]!];
  }
  return value;
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.length > 0 && value !== "false";
  if (typeof value === "number") return value !== 0;
  return true;
}
