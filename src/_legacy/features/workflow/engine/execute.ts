import { randomUUID } from "node:crypto";
import type { CompiledWorkflow } from "./compile.js";
import type { WorkflowRun, StepResult, WorkflowNode } from "../types.js";
import { executeTrigger } from "./nodes/trigger.js";
import { executeAgentCall } from "./nodes/agent-call.js";
import { executeToolCall } from "./nodes/tool-call.js";
import { executeIf } from "./nodes/if.js";
import { executeBranch } from "./nodes/branch.js";
import { executeLoop } from "./nodes/loop.js";

export interface ExecutionContext {
  orgId: string;
  runId: string;
  triggerData: Record<string, unknown>;
  variables: Map<string, unknown>;
  onStepUpdate: (step: StepResult) => void;
}

export interface NodeResult {
  output: unknown;
  nextNodeIds: string[];
}

export function createRun(
  compiled: CompiledWorkflow,
  triggerData: Record<string, unknown>,
): WorkflowRun {
  return {
    id: randomUUID(),
    workflowId: compiled.id,
    orgId: compiled.orgId,
    status: "pending",
    triggerData,
    steps: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    conversationId: null,
    triggerSource: "manual",
  };
}

export async function executeWorkflow(
  compiled: CompiledWorkflow,
  run: WorkflowRun,
  onStepUpdate: (step: StepResult) => void,
): Promise<WorkflowRun> {
  const ctx: ExecutionContext = {
    orgId: compiled.orgId,
    runId: run.id,
    triggerData: run.triggerData,
    variables: new Map(),
    onStepUpdate,
  };

  run.status = "running";
  const queue: string[] = [compiled.entryNodeId];
  const executed = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (executed.has(nodeId)) continue;

    const node = compiled.nodes.get(nodeId);
    if (!node) {
      run.status = "failed";
      break;
    }

    const step = await executeNode(node, ctx, compiled);
    run.steps.push(step);
    onStepUpdate(step);
    executed.add(nodeId);

    if (step.status === "failed") {
      run.status = "failed";
      break;
    }

    if (step.status === "waiting-approval") {
      run.status = "waiting-approval";
      break;
    }

    const result = step.output as NodeResult | null;
    if (result?.nextNodeIds) {
      for (const next of result.nextNodeIds) {
        if (!executed.has(next)) queue.push(next);
      }
    } else {
      const defaultNext = compiled.adjacency.get(nodeId) ?? [];
      for (const next of defaultNext) {
        if (!executed.has(next)) queue.push(next);
      }
    }
  }

  if (run.status === "running") {
    run.status = "completed";
  }
  run.completedAt = new Date().toISOString();
  return run;
}

async function executeNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
  compiled: CompiledWorkflow,
): Promise<StepResult> {
  const step: StepResult = {
    nodeId: node.id,
    status: "running",
    output: null,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  ctx.onStepUpdate(step);

  try {
    const result = await dispatchNode(node, ctx, compiled);
    step.status = "completed";
    step.output = result;
    step.completedAt = new Date().toISOString();
    ctx.variables.set(node.id, result);
  } catch (err) {
    step.status = "failed";
    step.error = err instanceof Error ? err.message : String(err);
    step.completedAt = new Date().toISOString();
  }

  return step;
}

async function dispatchNode(
  node: WorkflowNode,
  ctx: ExecutionContext,
  compiled: CompiledWorkflow,
): Promise<NodeResult> {
  const defaultNext = compiled.adjacency.get(node.id) ?? [];

  switch (node.config.type) {
    case "trigger":
      return executeTrigger(node, ctx, defaultNext);
    case "agent-call":
      return executeAgentCall(node, ctx, defaultNext);
    case "tool-call":
      return executeToolCall(node, ctx, defaultNext);
    case "if":
      return executeIf(node, ctx);
    case "branch":
      return executeBranch(node, ctx);
    case "loop":
      return executeLoop(node, ctx, compiled, defaultNext);
    case "merge":
      return { output: null, nextNodeIds: defaultNext };
    default:
      throw new Error(`Tipo nodo sconosciuto: ${node.type}`);
  }
}
