import type { WorkflowNode } from "../../types.js";
import type { ExecutionContext, NodeResult } from "../execute.js";

export async function executeToolCall(
  node: WorkflowNode,
  ctx: ExecutionContext,
  defaultNext: string[],
): Promise<NodeResult> {
  if (node.config.type !== "tool-call") {
    throw new Error("Config type mismatch");
  }

  const { toolName, toolArgs } = node.config;

  const interpolatedArgs = interpolateArgs(toolArgs, ctx.variables);

  // MVP: tool registry sara' esteso in M4. Per ora placeholder che logga.
  console.log(`[workflow-engine] tool-call: ${toolName}`, interpolatedArgs);

  return {
    output: {
      toolName,
      args: interpolatedArgs,
      result: `Tool "${toolName}" eseguito con successo`,
    },
    nextNodeIds: defaultNext,
  };
}

function interpolateArgs(
  args: Record<string, unknown>,
  vars: Map<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
      const path = value.slice(2, -2).trim().split(".");
      let resolved: unknown = vars.get(path[0]!);
      for (let i = 1; i < path.length && resolved != null; i++) {
        resolved = (resolved as Record<string, unknown>)[path[i]!];
      }
      result[key] = resolved ?? value;
    } else {
      result[key] = value;
    }
  }
  return result;
}
