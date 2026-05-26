import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createActivity } from "@/features/clients/store/activities.store.js";
import { currentClientScopedContext } from "../scoped-context.js";

const activityKindSchema = z.enum(["note", "call", "email", "meeting"]);

/**
 * Brain: clients-specialist-add-activity
 * Registra una interazione tipizzata (call/email/meeting). No HITL.
 */
export const addClientActivityTool = createTool({
  id: "add_client_activity",
  description:
    "Registra un evento di interazione (call, email, meeting) nella timeline del cliente attivo. " +
    "Per note generiche usa `add_client_note`.",
  inputSchema: z.object({
    kind: activityKindSchema,
    title: z.string().max(200),
    body: z.string().max(5000).optional(),
    occurredAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    activityId: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const ctx = currentClientScopedContext();
    const activity = await createActivity(
      { orgId: ctx.orgId, userId: ctx.userId, roles: ["member"] },
      ctx.clientId,
      {
        kind: context.kind,
        title: context.title,
        body: context.body,
        occurredAt: context.occurredAt,
        metadata: context.metadata,
      },
      { type: "agent", id: "client-specialist" },
    );
    if (!activity) return { ok: false };
    return { ok: true, activityId: activity.id };
  },
});
