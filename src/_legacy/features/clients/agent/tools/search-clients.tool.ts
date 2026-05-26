import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listClients } from "@/features/clients/store/clients.store.js";
import type { TenantContext } from "@/core/db/client.js";

/**
 * Analyst tool: search_clients
 *
 * NOTE: l'analyst context e' un singleton modulo-level (non AsyncLocalStorage).
 * La route /clients/analyst/chat imposta il context via `setAnalystToolContext`
 * prima di `agent.stream()` e lo pulisce nel finally. Non adatto a concurrency
 * (2 request sovrapposte si pestano i piedi) — TODO per Fase 4+ passare a
 * AsyncLocalStorage come il Specialist.
 */

const lifecycleStageSchema = z.enum([
  "prospect",
  "active",
  "inactive",
  "churned",
  "blacklisted",
]);

interface AnalystToolCtx {
  orgId: string;
  userId: string;
  roles: string[];
}

let currentCtx: AnalystToolCtx | null = null;

export function setAnalystToolContext(ctx: AnalystToolCtx | null): void {
  currentCtx = ctx;
}

function requireCtx(): TenantContext {
  if (!currentCtx) {
    throw new Error(
      "[analyst-tools] nessun context: chiamata fuori da /clients/analyst/chat",
    );
  }
  return {
    orgId: currentCtx.orgId,
    userId: currentCtx.userId,
    roles: currentCtx.roles,
  };
}

export const searchClientsTool = createTool({
  id: "search_clients",
  description:
    "Cerca clienti dell'organizzazione con filtri strutturati. Ritorna lista di 1-200 clienti. " +
    "Usalo quando l'utente chiede 'chi', 'quali clienti', 'elenca', 'trova', 'top N'. " +
    "Per 'top N per fatturato/health/nome' usa il parametro `sort` appropriato.",
  inputSchema: z.object({
    search: z.string().optional().describe("Nome parziale (fuzzy match)"),
    stage: z.array(lifecycleStageSchema).optional(),
    tags: z.array(z.string()).optional(),
    country: z.string().length(2).optional(),
    region: z.string().optional(),
    lastInteractionBefore: z.string().datetime().optional(),
    lastInteractionAfter: z.string().datetime().optional(),
    healthMin: z.number().min(0).max(100).optional(),
    healthMax: z.number().min(0).max(100).optional(),
    sort: z
      .enum(["last_interaction", "name", "revenue", "health"])
      .optional()
      .describe(
        "Criterio ordinamento. Default 'last_interaction' (piu' recenti). " +
          "Per top per fatturato usa 'revenue' + sortDir 'desc'. " +
          "Per top per health score usa 'health' + 'desc'.",
      ),
    sortDir: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  outputSchema: z.object({
    items: z.array(z.record(z.unknown())),
    total: z.number(),
  }),
  execute: async ({ context }) => {
    const tenantCtx = requireCtx();
    const result = await listClients(tenantCtx, {
      search: context.search,
      stage: context.stage,
      tags: context.tags,
      country: context.country,
      region: context.region,
      lastInteractionFrom: context.lastInteractionAfter,
      lastInteractionTo: context.lastInteractionBefore,
      healthMin: context.healthMin,
      healthMax: context.healthMax,
      sort: context.sort,
      sortDir: context.sortDir,
      limit: context.limit,
    });
    return {
      items: result.items as unknown as Record<string, unknown>[],
      total: result.items.length,
    };
  },
});

export { requireCtx as requireAnalystTenantCtx };
