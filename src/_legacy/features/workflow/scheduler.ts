import cron, { type ScheduledTask } from "node-cron";
import { getWorkflowStore } from "./store/index.js";
import { compile } from "./engine/compile.js";
import { createRun, executeWorkflow } from "./engine/execute.js";
import { createRunConversation, logStepToConversation, closeRunConversation } from "./inbox-integration.js";
import type { Workflow, StepResult } from "./types.js";

/**
 * Brain: 024-workflow-module — cron scheduler in-process.
 * - Al boot scansiona workflow con status=active + trigger cron
 * - Al PATCH /workflow/:id (status o nodes) → refresh job
 * - Al DELETE → unregister
 * Jobs sono tenuti in Map keyed by workflowId.
 * Se il server muore, al restart ri-registra tutto → recovery automatico.
 */

interface JobEntry {
  task: ScheduledTask;
  cronExpression: string;
  workflowId: string;
}

const jobs = new Map<string, JobEntry>();

function findCronTrigger(wf: Workflow): string | null {
  const trigger = wf.nodes.find((n) => n.config.type === "trigger");
  if (!trigger) return null;
  if (trigger.config.type !== "trigger") return null;
  if (trigger.config.triggerType !== "cron") return null;
  const expr = trigger.config.cronExpression;
  if (!expr || typeof expr !== "string") return null;
  return expr;
}

async function executeCronTriggered(wf: Workflow): Promise<void> {
  const store = getWorkflowStore();
  const compiled = compile(wf);
  if (!compiled.ok || !compiled.workflow) {
    console.warn(
      `[scheduler] workflow "${wf.name}" (${wf.id}) skip: ${compiled.errors
        .map((e) => e.message)
        .join(" | ")}`,
    );
    return;
  }

  const run = createRun(compiled.workflow, { triggeredAt: new Date().toISOString() });
  run.triggerSource = "cron";

  const conversationId = await createRunConversation(wf, run);
  run.conversationId = conversationId;

  await store.saveRun(run);

  try {
    const finished = await executeWorkflow(compiled.workflow, run, async (step: StepResult) => {
      if (conversationId) {
        const node = compiled.workflow!.nodes.get(step.nodeId);
        await logStepToConversation(conversationId, step, node);
      }
      await store.updateRun(wf.orgId, run.id, {
        steps: [...run.steps],
        status: run.status,
      });
    });
    await store.updateRun(wf.orgId, run.id, {
      status: finished.status,
      completedAt: finished.completedAt,
      steps: finished.steps,
    });
    if (conversationId) await closeRunConversation(conversationId, finished);
  } catch (err) {
    console.error(`[scheduler] run ${run.id} failed:`, err);
  }
}

export function registerWorkflow(wf: Workflow): void {
  unregisterWorkflow(wf.id);

  if (wf.status !== "active") return;
  const expr = findCronTrigger(wf);
  if (!expr) return;

  if (!cron.validate(expr)) {
    console.warn(
      `[scheduler] workflow "${wf.name}" (${wf.id}) ha cron expression invalida: ${expr}`,
    );
    return;
  }

  const task = cron.schedule(expr, () => {
    console.log(`[scheduler] firing workflow "${wf.name}" (${wf.id})`);
    void executeCronTriggered(wf);
  });

  jobs.set(wf.id, { task, cronExpression: expr, workflowId: wf.id });
  console.log(`[scheduler] registered "${wf.name}" (${wf.id}) on "${expr}"`);
}

export function unregisterWorkflow(workflowId: string): void {
  const entry = jobs.get(workflowId);
  if (!entry) return;
  entry.task.stop();
  jobs.delete(workflowId);
  console.log(`[scheduler] unregistered ${workflowId}`);
}

export async function bootScheduler(orgIds: string[]): Promise<void> {
  const store = getWorkflowStore();
  let count = 0;
  for (const orgId of orgIds) {
    const all = await store.list(orgId);
    for (const wf of all) {
      const before = jobs.size;
      registerWorkflow(wf);
      if (jobs.size > before) count++;
    }
  }
  console.log(`[scheduler] boot complete — ${count} workflow attivi registrati`);
}

export function listActiveJobs(): Array<{ workflowId: string; cron: string }> {
  return [...jobs.values()].map((j) => ({
    workflowId: j.workflowId,
    cron: j.cronExpression,
  }));
}
