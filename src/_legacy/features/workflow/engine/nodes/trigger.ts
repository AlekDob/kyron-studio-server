import type { WorkflowNode } from "../../types.js";
import type { ExecutionContext, NodeResult } from "../execute.js";

export async function executeTrigger(
  _node: WorkflowNode,
  ctx: ExecutionContext,
  defaultNext: string[],
): Promise<NodeResult> {
  return {
    output: { triggerData: ctx.triggerData },
    nextNodeIds: defaultNext,
  };
}
