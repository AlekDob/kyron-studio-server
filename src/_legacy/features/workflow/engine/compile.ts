import { workflowSchema } from "../types.js";
import type { Workflow, WorkflowNode, WorkflowEdge } from "../types.js";

export interface CompiledWorkflow {
  id: string;
  orgId: string;
  entryNodeId: string;
  nodes: Map<string, WorkflowNode>;
  edges: Map<string, WorkflowEdge>;
  adjacency: Map<string, string[]>;
}

export interface CompileError {
  nodeId?: string;
  message: string;
}

export interface CompileResult {
  ok: boolean;
  workflow?: CompiledWorkflow;
  errors: CompileError[];
}

export function compile(raw: Workflow): CompileResult {
  const errors: CompileError[] = [];

  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        message: `${i.path.join(".")}: ${i.message}`,
      })),
    };
  }

  const wf = parsed.data;
  const nodes = new Map(wf.nodes.map((n) => [n.id, n]));
  const edges = new Map(wf.edges.map((e) => [e.id, e]));

  const triggers = wf.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) {
    errors.push({ message: "Il workflow deve avere almeno un nodo trigger" });
  }
  if (triggers.length > 1) {
    errors.push({ message: "MVP supporta un solo trigger per workflow" });
  }

  for (const edge of wf.edges) {
    if (!nodes.has(edge.source)) {
      errors.push({ nodeId: edge.source, message: `Edge ${edge.id}: source inesistente` });
    }
    if (!nodes.has(edge.target)) {
      errors.push({ nodeId: edge.target, message: `Edge ${edge.id}: target inesistente` });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const node of wf.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of wf.edges) {
    const list = adjacency.get(edge.source);
    if (list) list.push(edge.target);
  }

  if (detectCycle(adjacency)) {
    errors.push({ message: "Il grafo contiene un ciclo (loop nodes esclusi)" });
  }

  // Validazione strict per esecuzione: ora i config incompleti vengono bloccati qui
  // invece che nel save (cosi' i draft si salvano sempre).
  for (const node of wf.nodes) {
    const cfg = node.config;
    if (cfg.type === "agent-call") {
      if (!cfg.agentId) errors.push({ nodeId: node.id, message: `Nodo "${node.label}": agentId mancante` });
      if (!cfg.promptTemplate) errors.push({ nodeId: node.id, message: `Nodo "${node.label}": prompt vuoto` });
    }
    if (cfg.type === "tool-call" && !cfg.toolName) {
      errors.push({ nodeId: node.id, message: `Nodo "${node.label}": toolName mancante` });
    }
    if (cfg.type === "if" && !cfg.condition) {
      errors.push({ nodeId: node.id, message: `Nodo "${node.label}": condizione vuota` });
    }
    if (cfg.type === "loop" && !cfg.arrayExpression) {
      errors.push({ nodeId: node.id, message: `Nodo "${node.label}": array expression mancante` });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    workflow: {
      id: wf.id,
      orgId: wf.orgId,
      entryNodeId: triggers[0]!.id,
      nodes,
      edges,
      adjacency,
    },
  };
}

function detectCycle(adj: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (dfs(next)) return true;
    }
    stack.delete(node);
    return false;
  }

  for (const node of adj.keys()) {
    if (dfs(node)) return true;
  }
  return false;
}
