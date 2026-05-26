import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/core/auth/middleware.js";
import { getWorkflowStore } from "./store/index.js";
import cron from "node-cron";
import { compile } from "./engine/compile.js";
import { createRun, executeWorkflow } from "./engine/execute.js";
import { createRunConversation, logStepToConversation, closeRunConversation } from "./inbox-integration.js";
import { registerWorkflow, unregisterWorkflow } from "./scheduler.js";
import { resolveForProcess } from "@/core/llm/resolver.js";
import { generateText } from "ai";
import type { StepResult } from "./types.js";

type AuthedEnv = { Variables: { userId: string } };

export const workflowRoute = new Hono<AuthedEnv>();

workflowRoute.use("*", authMiddleware);

const orgId = "org-dev"; // M4: extract from auth token

// ── CRUD ────────────────────────────────────────────────────

workflowRoute.get("/", async (c) => {
  const store = getWorkflowStore();
  let workflows = await store.list(orgId);

  const tagFilter = c.req.query("tags");
  if (tagFilter) {
    const tags = tagFilter.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tags.length > 0) {
      workflows = workflows.filter((w) =>
        tags.every((t) => w.tags.includes(t)),
      );
    }
  }

  const statusFilter = c.req.query("status");
  if (statusFilter) {
    workflows = workflows.filter((w) => w.status === statusFilter);
  }

  const q = c.req.query("q")?.toLowerCase();
  if (q) {
    workflows = workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q),
    );
  }

  return c.json({
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? "",
      status: w.status ?? "draft",
      tags: w.tags ?? [],
      nodeCount: w.nodes?.length ?? 0,
      version: w.version ?? 1,
      updatedAt: w.updatedAt,
    })),
  });
});

// Aggregato di tutti i tag usati, utile per il TagFilter in UI
workflowRoute.get("/tags", async (c) => {
  const store = getWorkflowStore();
  const workflows = await store.list(orgId);
  const tagCount = new Map<string, number>();
  for (const w of workflows) {
    for (const t of w.tags) {
      tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }
  return c.json({
    tags: [...tagCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
  });
});

workflowRoute.get("/:id", async (c) => {
  const store = getWorkflowStore();
  const wf = await store.get(orgId, c.req.param("id"));
  if (!wf) return c.json({ error: "Workflow non trovato" }, 404);
  return c.json(wf);
});

const saveBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
});

workflowRoute.post("/", async (c) => {
  const body = saveBodySchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ error: body.error.flatten() }, 400);
  }
  const store = getWorkflowStore();
  const userId = c.get("userId");
  try {
    const wf = await store.save({
      orgId,
      name: body.data.name,
      description: body.data.description,
      tags: body.data.tags,
      status: "draft",
      nodes: body.data.nodes as never[],
      edges: body.data.edges as never[],
      createdBy: userId,
    });
    return c.json(wf, 201);
  } catch (err) {
    console.error("[workflow POST /] save failed:", err);
    if (err instanceof z.ZodError) {
      return c.json({ error: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })) }, 400);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

const patchBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  nodes: z.array(z.unknown()).optional(),
  edges: z.array(z.unknown()).optional(),
});

workflowRoute.patch("/:id", async (c) => {
  const body = patchBodySchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ error: body.error.flatten() }, 400);
  }
  const store = getWorkflowStore();
  try {
    const updated = await store.update(orgId, c.req.param("id"), body.data as never);
    // Re-register nello scheduler: se status o nodes sono cambiati, il cron va aggiornato.
    registerWorkflow(updated);
    return c.json(updated);
  } catch (err) {
    console.error("[workflow PATCH /:id] update failed:", err);
    if (err instanceof z.ZodError) {
      return c.json({ error: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })) }, 400);
    }
    return c.json({ error: (err as Error).message }, 400);
  }
});

workflowRoute.delete("/:id", async (c) => {
  const store = getWorkflowStore();
  const id = c.req.param("id");
  unregisterWorkflow(id);
  const ok = await store.delete(orgId, id);
  return ok ? c.json({ deleted: true }) : c.json({ error: "Non trovato" }, 404);
});

// ── Validate ────────────────────────────────────────────────

workflowRoute.post("/:id/validate", async (c) => {
  const store = getWorkflowStore();
  const wf = await store.get(orgId, c.req.param("id"));
  if (!wf) return c.json({ error: "Workflow non trovato" }, 404);

  const result = compile(wf);
  return c.json({ valid: result.ok, errors: result.errors });
});

// ── Execute ─────────────────────────────────────────────────

workflowRoute.post("/:id/execute", async (c) => {
  const store = getWorkflowStore();
  const wf = await store.get(orgId, c.req.param("id"));
  if (!wf) return c.json({ error: "Workflow non trovato" }, 404);

  const compiled = compile(wf);
  if (!compiled.ok || !compiled.workflow) {
    return c.json({ valid: false, errors: compiled.errors }, 400);
  }

  const triggerData = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const run = createRun(compiled.workflow, triggerData);
  run.triggerSource = "manual";

  const conversationId = await createRunConversation(wf, run);
  run.conversationId = conversationId;

  await store.saveRun(run);

  executeWorkflow(compiled.workflow, run, async (step: StepResult) => {
    if (conversationId) {
      const node = compiled.workflow!.nodes.get(step.nodeId);
      await logStepToConversation(conversationId, step, node);
    }
    await store.updateRun(orgId, run.id, { steps: [...run.steps], status: run.status });
  }).then(async (finishedRun) => {
    await store.updateRun(orgId, finishedRun.id, {
      status: finishedRun.status,
      completedAt: finishedRun.completedAt,
      steps: finishedRun.steps,
    });
    if (conversationId) await closeRunConversation(conversationId, finishedRun);
  }).catch((err) => {
    console.error(`[workflow] run ${run.id} failed:`, err);
  });

  return c.json({ runId: run.id, conversationId, status: "pending" }, 202);
});

// ── Stream run status (SSE) ─────────────────────────────────

workflowRoute.get("/:id/runs/:runId/stream", async (c) => {
  const store = getWorkflowStore();
  const runId = c.req.param("runId");

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (data: unknown): void => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        let lastStepCount = 0;
        const poll = setInterval(async () => {
          try {
            const run = await store.getRun(orgId, runId);
            if (!run) {
              send({ type: "error", message: "Run non trovato" });
              clearInterval(poll);
              controller.close();
              return;
            }

            if (run.steps.length > lastStepCount) {
              for (let i = lastStepCount; i < run.steps.length; i++) {
                send({ type: "step", step: run.steps[i] });
              }
              lastStepCount = run.steps.length;
            }

            if (["completed", "failed", "cancelled"].includes(run.status)) {
              send({ type: "done", status: run.status });
              clearInterval(poll);
              controller.close();
            }
          } catch (err) {
            send({ type: "error", message: (err as Error).message });
            clearInterval(poll);
            controller.close();
          }
        }, 500);
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );
});

// ── Cron helpers (NL <-> expression) ────────────────────────

const nlBodySchema = z.object({
  description: z.string().min(3).max(300),
});

function extractCronExpr(raw: string): string | null {
  // Rimuove eventuali backticks / markdown / quote / prefissi che i LLM aggiungono
  const cleaned = raw
    .replace(/```\w*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  // Cerca la prima riga che assomiglia a una cron expression (5 o 6 campi)
  for (const line of cleaned.split("\n")) {
    const candidate = line.trim().replace(/^["'`]+|["'`]+$/g, "");
    const fields = candidate.split(/\s+/);
    if ((fields.length === 5 || fields.length === 6) && cron.validate(candidate)) {
      return candidate;
    }
  }
  return null;
}

workflowRoute.post("/cron/nl-to-expression", async (c) => {
  const body = nlBodySchema.safeParse(await c.req.json());
  if (!body.success) {
    return c.json({ error: "description obbligatoria (3-300 char)" }, 400);
  }

  const model = await resolveForProcess(orgId, "astro-engineer", "cron_helper");
  if (!model) {
    return c.json({ error: "Nessun LLM configurato" }, 503);
  }

  const prompt = [
    "Sei un traduttore da linguaggio naturale a espressione cron (formato standard 5 campi: minuto ora giorno-mese mese giorno-settimana).",
    "Rispondi SOLO con l'espressione cron, senza backticks, senza spiegazioni, senza testo aggiuntivo.",
    "",
    "Esempi:",
    `"ogni lunedi alle 9" -> 0 9 * * 1`,
    `"ogni giorno a mezzogiorno" -> 0 12 * * *`,
    `"ogni 15 minuti" -> */15 * * * *`,
    `"il primo del mese alle 8" -> 0 8 1 * *`,
    `"ogni venerdi alle 17:30" -> 30 17 * * 5`,
    "",
    `Descrizione: "${body.data.description}"`,
    "Espressione cron:",
  ].join("\n");

  try {
    const result = await generateText({
      model,
      prompt,
      maxTokens: 30,
      temperature: 0,
    });
    const expr = extractCronExpr(result.text);
    if (!expr) {
      return c.json({
        error: "Non sono riuscito a produrre un'espressione cron valida",
        raw: result.text,
      }, 422);
    }
    return c.json({ expression: expr, raw: result.text });
  } catch (err) {
    console.error("[workflow] nl-to-cron failed:", err);
    return c.json({ error: (err as Error).message }, 500);
  }
});

const describeBodySchema = z.object({
  expression: z.string().min(1),
});

workflowRoute.post("/cron/describe", async (c) => {
  const body = describeBodySchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "expression obbligatoria" }, 400);

  if (!cron.validate(body.data.expression)) {
    return c.json({ error: "Espressione cron non valida" }, 400);
  }

  const model = await resolveForProcess(orgId, "astro-engineer", "cron_helper");
  if (!model) {
    return c.json({ description: body.data.expression, fallback: true });
  }

  const prompt = [
    "Dato un'espressione cron (formato 5 campi), rispondi in italiano con una sola frase breve che spiega quando scatta, in forma naturale.",
    "Rispondi SOLO con la frase, senza virgolette, senza prefissi.",
    "",
    "Esempi:",
    `0 9 * * 1 -> Ogni lunedi alle 09:00`,
    `0 12 * * * -> Ogni giorno a mezzogiorno`,
    `*/15 * * * * -> Ogni 15 minuti`,
    "",
    `Espressione: ${body.data.expression}`,
    "Descrizione:",
  ].join("\n");

  try {
    const result = await generateText({
      model,
      prompt,
      maxTokens: 50,
      temperature: 0.2,
    });
    const clean = result.text.replace(/^["'`]+|["'`.]+$/g, "").trim().split("\n")[0]!;
    return c.json({ description: clean });
  } catch (err) {
    return c.json({ description: body.data.expression, fallback: true, error: (err as Error).message });
  }
});

// ── Runs list ───────────────────────────────────────────────

workflowRoute.get("/:id/runs", async (c) => {
  const store = getWorkflowStore();
  const runs = await store.listRuns(orgId, c.req.param("id"));
  return c.json({ runs });
});
