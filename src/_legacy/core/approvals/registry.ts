import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Brain: m2-accounting-agent
 * HITL: tool si sospende finche' non arriva una decisione umana.
 * In-memory + TTL 5min. M4: persistenza su Postgres.
 */

export type ApprovalDecision = "approve" | "reject";

export interface ApprovalRequest {
  id: string;
  title: string;
  details: Record<string, unknown>;
  action: string;
}

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

const pending = new Map<string, PendingApproval>();
const TTL_MS = 5 * 60 * 1000;

export interface EmitApproval {
  (req: ApprovalRequest): void;
}

interface RequestContext {
  emitApproval: EmitApproval;
}

const context = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return context.run(ctx, fn);
}

export function currentEmitApproval(): EmitApproval {
  const ctx = context.getStore();
  if (!ctx) {
    throw new Error("Nessun request context attivo — chiamata fuori da /chat?");
  }
  return ctx.emitApproval;
}

export async function requestApproval(
  payload: Omit<ApprovalRequest, "id">,
): Promise<ApprovalDecision> {
  const id = randomUUID();
  const emit = currentEmitApproval();

  const promise = new Promise<ApprovalDecision>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Timeout: nessuna decisione entro 5 minuti"));
    }, TTL_MS);
    pending.set(id, { resolve, reject, timeout });
  });

  emit({ id, ...payload });
  return promise;
}

export function resolveApproval(id: string, decision: ApprovalDecision): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timeout);
  pending.delete(id);
  entry.resolve(decision);
  return true;
}
