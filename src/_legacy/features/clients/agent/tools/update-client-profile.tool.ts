import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { updateClient } from "@/features/clients/store/clients.store.js";
import { createActivity } from "@/features/clients/store/activities.store.js";
import { requestApproval } from "@/core/approvals/registry.js";
import { currentClientScopedContext } from "../scoped-context.js";

const lifecycleStageSchema = z.enum([
  "prospect",
  "active",
  "inactive",
  "churned",
  "blacklisted",
]);

/**
 * Brain: clients-specialist-update-profile
 * HITL: le modifiche anagrafica passano per `requestApproval`. Il registry
 * emette l'evento SSE al client; rejection => early return, approval => update
 * + audit activity kind=status_change.
 */
export const updateClientProfileTool = createTool({
  id: "update_client_profile",
  description:
    "Propone modifiche alla scheda anagrafica del cliente attivo. IMPORTANTE: richiede " +
    "approvazione umana tramite card di conferma — non eseguire senza autorizzazione.",
  inputSchema: z.object({
    changes: z.object({
      name: z.string().optional(),
      legalName: z.string().optional(),
      vatNumber: z.string().optional(),
      lifecycleStage: lifecycleStageSchema.optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.unknown()).optional(),
      website: z.string().url().optional(),
      industry: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().length(2).optional(),
    }),
    reason: z
      .string()
      .max(500)
      .describe("Motivo del cambio, visibile nell'audit log"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.enum(["approved", "rejected"]),
    client: z.record(z.unknown()).optional(),
  }),
  execute: async ({ context }) => {
    const ctx = currentClientScopedContext();
    const decision = await requestApproval({
      title: "Aggiornamento scheda cliente",
      action: "update_client_profile",
      details: {
        clientId: ctx.clientId,
        changes: context.changes,
        reason: context.reason,
      },
    });
    if (decision === "reject") {
      return { ok: false, status: "rejected" as const };
    }
    const tenantCtx = {
      orgId: ctx.orgId,
      userId: ctx.userId,
      roles: ["member"],
    };
    const updated = await updateClient(tenantCtx, ctx.clientId, context.changes);
    await createActivity(
      tenantCtx,
      ctx.clientId,
      {
        kind: "status_change",
        title: "Scheda aggiornata via agente",
        body: context.reason,
        metadata: { changes: context.changes },
      },
      { type: "agent", id: "client-specialist" },
    );
    return {
      ok: true,
      status: "approved" as const,
      client: (updated ?? undefined) as Record<string, unknown> | undefined,
    };
  },
});
