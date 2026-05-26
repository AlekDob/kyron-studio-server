import { z } from "zod";

// ── Node types ──────────────────────────────────────────────

export const triggerTypeSchema = z.enum(["manual", "cron", "webhook"]);

export const nodeTypeSchema = z.enum([
  "trigger",
  "agent-call",
  "tool-call",
  "if",
  "branch",
  "loop",
  "merge",
]);

export const triggerConfigSchema = z.object({
  triggerType: triggerTypeSchema,
  cronExpression: z.string().optional(),
  webhookPath: z.string().optional(),
});

// NOTA: i campi stringa sono tolleranti (no min(1)) per permettere il salvataggio
// di draft incompleti. La validazione strict avviene in compile.ts prima dell'execute.
export const agentCallConfigSchema = z.object({
  agentId: z.string().default(""),
  promptTemplate: z.string().default(""),
  maxSteps: z.number().int().min(1).max(20).default(6),
});

export const toolCallConfigSchema = z.object({
  toolName: z.string().default(""),
  toolArgs: z.record(z.unknown()).default({}),
});

export const ifConfigSchema = z.object({
  condition: z.string().default(""),
  trueEdge: z.string().default(""),
  falseEdge: z.string().default(""),
});

export const branchConfigSchema = z.object({
  branches: z.array(z.object({
    label: z.string(),
    condition: z.string(),
    edgeId: z.string(),
  })),
  defaultEdge: z.string().optional(),
});

export const loopConfigSchema = z.object({
  arrayExpression: z.string().default(""),
  iteratorVar: z.string().default("item"),
  maxIterations: z.number().int().min(1).max(1000).default(100),
});

export const mergeConfigSchema = z.object({
  strategy: z.enum(["wait-all", "first"]).default("wait-all"),
});

export const nodeConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trigger"), ...triggerConfigSchema.shape }),
  z.object({ type: z.literal("agent-call"), ...agentCallConfigSchema.shape }),
  z.object({ type: z.literal("tool-call"), ...toolCallConfigSchema.shape }),
  z.object({ type: z.literal("if"), ...ifConfigSchema.shape }),
  z.object({ type: z.literal("branch"), ...branchConfigSchema.shape }),
  z.object({ type: z.literal("loop"), ...loopConfigSchema.shape }),
  z.object({ type: z.literal("merge"), ...mergeConfigSchema.shape }),
]);

// ── Graph elements ──────────────────────────────────────────

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: nodeTypeSchema,
  label: z.string(),
  config: nodeConfigSchema,
  position: z.object({ x: z.number(), y: z.number() }),
});

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  condition: z.string().optional(),
});

// ── Workflow ────────────────────────────────────────────────

export const workflowStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "archived",
]);

export const workflowSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  status: workflowStatusSchema.default("draft"),
  tags: z.array(z.string().trim().toLowerCase()).default([]),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  version: z.number().int().default(1),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ── Run ─────────────────────────────────────────────────────

export const runStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting-approval",
]);

export const stepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "waiting-approval",
]);

export const stepResultSchema = z.object({
  nodeId: z.string(),
  status: stepStatusSchema,
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const workflowRunSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  orgId: z.string(),
  status: runStatusSchema.default("pending"),
  triggerData: z.record(z.unknown()).default({}),
  steps: z.array(stepResultSchema).default([]),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  conversationId: z.string().uuid().nullable().default(null),
  triggerSource: z.enum(["manual", "cron", "webhook"]).default("manual"),
});

// ── Inferred types ──────────────────────────────────────────

export type TriggerType = z.infer<typeof triggerTypeSchema>;
export type NodeType = z.infer<typeof nodeTypeSchema>;
export type NodeConfig = z.infer<typeof nodeConfigSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type StepStatus = z.infer<typeof stepStatusSchema>;
export type StepResult = z.infer<typeof stepResultSchema>;
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

export type CreateWorkflowInput = Omit<Workflow, "id" | "createdAt" | "updatedAt" | "version">;
export type UpdateWorkflowInput = Partial<Pick<Workflow, "name" | "description" | "status" | "tags" | "nodes" | "edges">>;
