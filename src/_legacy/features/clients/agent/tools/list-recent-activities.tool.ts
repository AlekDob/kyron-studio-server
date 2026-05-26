import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { desc, eq, gte, and } from "drizzle-orm";
import { txWithTenant } from "@/core/db/client.js";
import { clientActivities } from "@/core/db/schema/index.js";
import { requireAnalystTenantCtx } from "./search-clients.tool.js";

const kindSchema = z.enum([
  "note",
  "call",
  "email",
  "meeting",
  "document_uploaded",
  "agent_insight",
  "status_change",
  "opportunity_created",
]);

export const listRecentActivitiesTool = createTool({
  id: "list_recent_activities",
  description:
    "Restituisce le attivita' recenti nell'organizzazione, cross-cliente. " +
    "Utile per 'cosa e' successo questa settimana' / 'ultime interazioni registrate'.",
  inputSchema: z.object({
    kind: z.array(kindSchema).optional(),
    sinceDays: z.number().int().min(1).max(365).default(7),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  outputSchema: z.object({
    items: z.array(z.record(z.unknown())),
  }),
  execute: async ({ context }) => {
    const tenantCtx = requireAnalystTenantCtx();
    const sinceMs = Date.now() - context.sinceDays * 86_400_000;
    return txWithTenant(tenantCtx, async (tx) => {
      const baseCond = gte(clientActivities.occurredAt, new Date(sinceMs));
      const cond =
        context.kind && context.kind.length > 0
          ? and(baseCond, eq(clientActivities.kind, context.kind[0]))
          : baseCond;
      const rows = await tx
        .select()
        .from(clientActivities)
        .where(cond)
        .orderBy(desc(clientActivities.occurredAt))
        .limit(context.limit);
      return { items: rows as unknown as Record<string, unknown>[] };
    });
  },
});
