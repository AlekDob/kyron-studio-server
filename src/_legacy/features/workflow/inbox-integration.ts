import {
  createConversation,
  appendMessage,
  touchConversation,
} from "@/features/inbox/store.js";
import type { Workflow, WorkflowRun, StepResult, WorkflowNode } from "./types.js";

/**
 * Brain: 024-workflow-module
 * Formattazione professionale dei messaggi di run in Inbox.
 *
 * Principi:
 * - Testo leggibile nel `content` (markdown minimale)
 * - Payload tecnico nel `toolCalls` (JSON) — il client lo apre on-demand
 *   dalla timeline tecnica accessibile via icona nell'header chat.
 * - Step intermedi "running" NON vengono mai scritti: troppo rumore,
 *   il log step-by-step in tempo reale vive nello StatusPanel del canvas.
 * - Step di tipo trigger/merge non producono messaggi (trivial).
 */

const FALLBACK_AGENT_ID = "astro-engineer";

/**
 * L'agentId della conversation di run e' quello del primo agent-call nel workflow:
 * cosi' in Inbox il mittente e l'avatar rispecchiano l'agente che risponde davvero
 * (Brain, Contabilita', ecc.) invece di Astro Engineer, che e' il designer dei workflow.
 * Se il workflow non ha agent-call (solo tool/logic), cade su astro-engineer come automazione generica.
 */
function pickConversationAgentId(wf: Workflow): string {
  for (const node of wf.nodes) {
    if (node.config.type === "agent-call") {
      const agentId = node.config.agentId;
      if (agentId) return agentId;
    }
  }
  return FALLBACK_AGENT_ID;
}

export async function createRunConversation(
  wf: Workflow,
  run: WorkflowRun,
): Promise<string | null> {
  try {
    const userId = wf.createdBy || "dev-anon";
    const sourceLabel =
      run.triggerSource === "cron" ? "cron" :
      run.triggerSource === "webhook" ? "webhook" : "manuale";
    const title = `${wf.name} · ${sourceLabel}`;
    const conversationAgentId = pickConversationAgentId(wf);
    const conv = await createConversation(userId, conversationAgentId, title);

    // Header system message: compatto nella chat, completo in toolCalls per la Timeline.
    // Content minimale: solo il source label del trigger (il nome workflow e' gia' nel title).
    await appendMessage(conv.id, "system", `Trigger ${sourceLabel}`, {
      kind: "run-header",
      workflowId: wf.id,
      workflowName: wf.name,
      runId: run.id,
      triggerSource: run.triggerSource,
      triggerData: run.triggerData,
    });

    return conv.id;
  } catch (err) {
    console.error("[inbox-integration] createRunConversation failed:", err);
    return null;
  }
}

/**
 * Scrive un messaggio step solo quando lo step e' terminato (success/failed).
 * Gli step "running" sono ignorati (rumore per l'utente finale).
 */
export async function logStepToConversation(
  conversationId: string,
  step: StepResult,
  node: WorkflowNode | undefined,
): Promise<void> {
  // Skip step intermedi: il log live vive sullo StatusPanel del canvas
  if (step.status !== "completed" && step.status !== "failed" && step.status !== "skipped") {
    return;
  }

  // Skip trigger e merge: trivial
  if (node && (node.type === "trigger" || node.type === "merge")) {
    return;
  }

  try {
    const { role, content, meta } = formatStep(step, node);
    await appendMessage(conversationId, role, content, meta);
    await touchConversation(
      conversationId,
      meta.summary ?? content.slice(0, 120),
      false, // l'unread lo incrementiamo solo sul messaggio finale di chiusura
      { preserveTitle: true },
    );
  } catch (err) {
    console.error("[inbox-integration] logStepToConversation failed:", err);
  }
}

export async function closeRunConversation(
  conversationId: string,
  run: WorkflowRun,
): Promise<void> {
  try {
    const totalSteps = run.steps.length;
    const failed = run.steps.filter((s) => s.status === "failed").length;
    const durationMs = run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : 0;

    // Quando il run e' andato a buon fine non scrivo alcun messaggio di chiusura:
    // l'utente vede gia' la risposta dell'agente, "Run completato" sarebbe rumore.
    // Chiamo comunque touchConversation per aggiornare last_message_at e scatenare
    // la notifica (incrementUnread=true), preservando il title originale.
    if (run.status === "completed" && failed === 0) {
      await touchConversation(
        conversationId,
        "", // nessun messaggio visibile ma scatena SSE InboxEvent
        true,
        { preserveTitle: true },
      );
      return;
    }

    // Altrimenti (failed / cancelled) il messaggio di chiusura serve a spiegare perche'.
    const verdict =
      run.status === "failed" ? "Run fallito" :
      run.status === "cancelled" ? "Run annullato" : "Run terminato";

    const parts = [`**${verdict}**`, `${totalSteps} step`];
    if (failed > 0) parts.push(`${failed} falliti`);
    if (durationMs > 0) parts.push(formatDuration(durationMs));
    const content = parts.join(" · ");

    await appendMessage(conversationId, "system", content, {
      kind: "run-summary",
      status: run.status,
      totalSteps,
      failedSteps: failed,
      durationMs,
    });
    await touchConversation(conversationId, content, true, { preserveTitle: true });
  } catch (err) {
    console.error("[inbox-integration] closeRunConversation failed:", err);
  }
}

// ── Formatting ──────────────────────────────────────────────

type Role = "user" | "agent" | "system";
interface FormattedStep {
  role: Role;
  content: string;
  meta: Record<string, unknown> & { summary?: string };
}

function formatStep(step: StepResult, node: WorkflowNode | undefined): FormattedStep {
  const label = node?.label ?? step.nodeId;
  const durationMs =
    step.startedAt && step.completedAt
      ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
      : null;

  if (step.status === "failed") {
    return {
      role: "system",
      content: `**Errore** in step "${label}"\n\n${step.error ?? "Errore sconosciuto"}`,
      meta: {
        kind: "step-error",
        nodeId: step.nodeId,
        nodeType: node?.type,
        error: step.error,
        rawOutput: step.output,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs,
        summary: `Errore: ${label}`,
      },
    };
  }

  if (step.status === "skipped") {
    return {
      role: "system",
      content: `Step "${label}" saltato`,
      meta: {
        kind: "step-skipped",
        nodeId: step.nodeId,
        nodeType: node?.type,
        summary: `Skipped: ${label}`,
      },
    };
  }

  // Brain: 024-workflow-module
  // step.output e' un NodeResult { output: unknown, nextNodeIds: string[] }
  // Il payload "vero" del nodo vive in step.output.output — serve de-wrap.
  const inner = unwrapNodeResult(step.output);

  if (node?.type === "agent-call") {
    const payload = inner as { text?: string; agentId?: string } | null;
    const text = payload?.text ?? "(nessuna risposta)";
    const agentId = payload?.agentId ?? "agent";
    const footer = [
      `_via ${humanizeAgent(agentId)}`,
      durationMs ? formatDuration(durationMs) : null,
    ]
      .filter(Boolean)
      .join(" · ") + "_";

    return {
      role: "agent",
      content: `${text}\n\n${footer}`,
      meta: {
        kind: "step-agent",
        nodeId: step.nodeId,
        nodeLabel: label,
        agentId,
        rawOutput: step.output,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs,
        summary: truncate(text, 120),
      },
    };
  }

  if (node?.type === "tool-call") {
    const payload = inner as { toolName?: string; result?: unknown } | null;
    const toolName = payload?.toolName ?? "tool";
    const durationStr = durationMs ? ` · ${formatDuration(durationMs)}` : "";
    return {
      role: "agent",
      content: `**Tool \`${toolName}\`** eseguito${durationStr}`,
      meta: {
        kind: "step-tool",
        nodeId: step.nodeId,
        nodeLabel: label,
        toolName,
        rawOutput: step.output,
        durationMs,
        summary: `Tool ${toolName}`,
      },
    };
  }

  if (node?.type === "if") {
    const payload = inner as { result?: boolean; condition?: string } | null;
    const result = payload?.result ? "vera" : "falsa";
    return {
      role: "system",
      content: `Condizione "${label}" valutata: **${result}**`,
      meta: {
        kind: "step-if",
        nodeId: step.nodeId,
        condition: payload?.condition,
        result: payload?.result,
        rawOutput: step.output,
        durationMs,
        summary: `If: ${result}`,
      },
    };
  }

  if (node?.type === "branch") {
    const payload = inner as { matched?: string } | null;
    return {
      role: "system",
      content: `Diramazione "${label}" → ramo **${payload?.matched ?? "default"}**`,
      meta: {
        kind: "step-branch",
        nodeId: step.nodeId,
        matched: payload?.matched,
        rawOutput: step.output,
        durationMs,
        summary: `Branch: ${payload?.matched ?? "default"}`,
      },
    };
  }

  if (node?.type === "loop") {
    const payload = inner as { iterations?: number } | null;
    return {
      role: "system",
      content: `Ciclo "${label}" completato (${payload?.iterations ?? 0} iterazioni)`,
      meta: {
        kind: "step-loop",
        nodeId: step.nodeId,
        iterations: payload?.iterations,
        rawOutput: step.output,
        durationMs,
        summary: `Loop ×${payload?.iterations ?? 0}`,
      },
    };
  }

  // Fallback generico
  return {
    role: "system",
    content: `Step "${label}" completato`,
    meta: {
      kind: "step-generic",
      nodeId: step.nodeId,
      nodeType: node?.type,
      rawOutput: step.output,
      durationMs,
      summary: label,
    },
  };
}

/**
 * L'engine wrappa ogni step output in NodeResult { output, nextNodeIds }.
 * Qui torna giu' di un livello per accedere al payload vero del nodo.
 * Se step.output non e' un NodeResult (caso edge), lo restituiamo invariato.
 */
function unwrapNodeResult(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "output" in raw && "nextNodeIds" in raw) {
    return (raw as { output: unknown }).output;
  }
  return raw;
}

function humanizeAgent(agentId: string): string {
  const map: Record<string, string> = {
    accounting: "Agente Contabilita'",
    brain: "Agente Brain",
    "astro-engineer": "Astro Engineer",
  };
  return map[agentId] ?? `Agente ${agentId}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
