import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listActivitiesForClient } from "@/features/clients/store/activities.store.js";
import { currentClientScopedContext } from "../scoped-context.js";

const activityKindSchema = z.enum([
  "note",
  "call",
  "email",
  "meeting",
  "document_uploaded",
  "agent_insight",
  "status_change",
  "opportunity_created",
]);

/**
 * Brain: clients-specialist-list-activities
 * Read-only timeline reader con filtro per tipo attivita'.
 */
export const listClientActivitiesTool = createTool({
  id: "list_client_activities",
  description:
    "Legge la timeline di attivita' del cliente attivo. Filtro opzionale per tipo.",
  inputSchema: z.object({
    kind: z.array(activityKindSchema).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  outputSchema: z.object({
    items: z.array(z.record(z.unknown())),
  }),
  execute: async ({ context }) => {
    const ctx = currentClientScopedContext();
    const result = await listActivitiesForClient(
      { orgId: ctx.orgId, userId: ctx.userId, roles: ["member"] },
      ctx.clientId,
      { limit: context.limit, kind: context.kind },
    );
    return { items: result.items as unknown as Record<string, unknown>[] };
  },
});
