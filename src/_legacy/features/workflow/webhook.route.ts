import { Hono } from "hono";
import { getWorkflowStore } from "./store/index.js";
import { compile } from "./engine/compile.js";
import { createRun, executeWorkflow } from "./engine/execute.js";
import { createRunConversation, logStepToConversation, closeRunConversation } from "./inbox-integration.js";
import type { StepResult, Workflow } from "./types.js";

/**
 * Brain: 024-workflow-module — webhook trigger pubblico.
 * Mount: app.route("/hooks", webhookRoute)
 * Matcha workflow con status="active" + trigger type "webhook" + webhookPath uguale a :path
 *
 * Nota: no auth. L'endpoint e' pubblico by design. Per sicurezza il workflow
 * dovrebbe validare manually il body (non c'e' HMAC automatico in questa versione).
 */

const orgId = "org-dev"; // M4: risolvere org dal path/header

export const webhookRoute = new Hono();

function normalizeWebhookPath(raw: string | undefined): string | null {
  if (!raw) return null;
  let p = raw.trim();
  if (!p) return null;
  // Tolera path senza slash iniziale
  if (!p.startsWith("/")) p = "/" + p;
  // Tolera se l'utente ha ripetuto il prefisso /hooks (gia' aggiunto dal router)
  if (p.startsWith("/hooks/")) p = p.slice("/hooks".length);
  if (p === "/hooks") p = "/";
  return p;
}

function matchesWebhook(wf: Workflow, path: string): boolean {
  if (wf.status !== "active") return false;
  const trigger = wf.nodes.find((n) => n.config.type === "trigger");
  if (!trigger || trigger.config.type !== "trigger") return false;
  if (trigger.config.triggerType !== "webhook") return false;
  const configured = normalizeWebhookPath(trigger.config.webhookPath);
  return configured === path;
}

webhookRoute.post("/:path{.+}", async (c) => {
  const path = "/" + c.req.param("path");
  const store = getWorkflowStore();
  const all = await store.list(orgId);
  const wf = all.find((w) => matchesWebhook(w, path));

  if (!wf) {
    return c.json({ error: `Nessun workflow attivo con webhook path ${path}` }, 404);
  }

  const compiled = compile(wf);
  if (!compiled.ok || !compiled.workflow) {
    return c.json({ error: "Workflow non compilabile", details: compiled.errors }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const headers = Object.fromEntries(c.req.raw.headers.entries());

  const run = createRun(compiled.workflow, { body, headers });
  run.triggerSource = "webhook";

  const conversationId = await createRunConversation(wf, run);
  run.conversationId = conversationId;

  await store.saveRun(run);

  // Execute async — webhook responds immediately with runId
  executeWorkflow(compiled.workflow, run, async (step: StepResult) => {
    if (conversationId) {
      const node = compiled.workflow!.nodes.get(step.nodeId);
      await logStepToConversation(conversationId, step, node);
    }
    await store.updateRun(orgId, run.id, { steps: [...run.steps], status: run.status });
  }).then(async (finished) => {
    await store.updateRun(orgId, finished.id, {
      status: finished.status,
      completedAt: finished.completedAt,
      steps: finished.steps,
    });
    if (conversationId) await closeRunConversation(conversationId, finished);
  }).catch((err) => {
    console.error(`[webhook] run ${run.id} failed:`, err);
  });

  return c.json({ runId: run.id, conversationId, accepted: true }, 202);
});
