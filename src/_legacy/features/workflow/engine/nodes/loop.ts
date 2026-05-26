import type { WorkflowNode } from "../../types.js";
import type { ExecutionContext, NodeResult } from "../execute.js";
import type { CompiledWorkflow } from "../compile.js";

export async function executeLoop(
  node: WorkflowNode,
  ctx: ExecutionContext,
  _compiled: CompiledWorkflow,
  defaultNext: string[],
): Promise<NodeResult> {
  if (node.config.type !== "loop") {
    throw new Error("Config type mismatch");
  }

  const { arrayExpression, iteratorVar, maxIterations } = node.config;

  const array = resolveArray(arrayExpression, ctx.variables);
  if (!Array.isArray(array)) {
    throw new Error(`Loop: "${arrayExpression}" non e' un array`);
  }

  const capped = array.slice(0, maxIterations);
  const results: unknown[] = [];

  for (const item of capped) {
    ctx.variables.set(iteratorVar, item);
    results.push(item);
  }

  ctx.variables.set(`${node.id}_results`, results);

  return {
    output: { iterations: results.length, results },
    nextNodeIds: defaultNext,
  };
}

function resolveArray(
  expr: string,
  vars: Map<string, unknown>,
): unknown {
  const match = expr.match(/^\{\{(\w+(?:\.\w+)*)\}\}$/);
  if (!match) {
    try {
      return JSON.parse(expr);
    } catch {
      return expr;
    }
  }
  const parts = match[1]!.split(".");
  let value: unknown = vars.get(parts[0]!);
  for (let i = 1; i < parts.length && value != null; i++) {
    value = (value as Record<string, unknown>)[parts[i]!];
  }
  return value;
}
