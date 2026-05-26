import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createActivity } from "@/features/clients/store/activities.store.js";
import { currentClientScopedContext } from "../scoped-context.js";

/**
 * Brain: clients-specialist-add-note
 * Scrive una nota nella timeline. No HITL: l'utente sta gia' vedendo la chat.
 */
export const addClientNoteTool = createTool({
  id: "add_client_note",
  description:
    "Aggiunge una nota alla timeline del cliente attivo. Usalo quando l'utente chiede " +
    "di annotare qualcosa di rilevante (es. 'segna che ha chiesto sconto del 10%').",
  inputSchema: z.object({
    title: z.string().max(200),
    body: z.string().max(5000),
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
      { kind: "note", title: context.title, body: context.body },
      { type: "agent", id: "client-specialist" },
    );
    if (!activity) return { ok: false };
    return { ok: true, activityId: activity.id };
  },
});
