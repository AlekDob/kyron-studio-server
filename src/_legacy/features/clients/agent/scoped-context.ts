import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Client Specialist scoped context.
 *
 * Brain: 002-clients-agent-scoped-context
 * Tools resolved inside an agent turn need to know which client we are chatting
 * about. Mastra does not pass tenant/client identifiers through the tool
 * `context`, so we propagate them via AsyncLocalStorage (same pattern as the
 * approvals registry). Entry point is `withClientScopedContext`, called from
 * `POST /clients/:clientId/chat` before `agent.stream()`.
 */

export interface ClientScopedContext {
  orgId: string;
  userId: string;
  clientId: string;
}

const storage = new AsyncLocalStorage<ClientScopedContext>();

export function withClientScopedContext<T>(
  ctx: ClientScopedContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentClientScopedContext(): ClientScopedContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      "[clients/agent] nessun scoped context — chiamata fuori da /clients/:id/chat?",
    );
  }
  return ctx;
}
