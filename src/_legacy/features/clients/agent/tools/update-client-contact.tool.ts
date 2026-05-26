import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { updateContact } from "@/features/clients/store/contacts.store.js";
import { requestApproval } from "@/core/approvals/registry.js";
import { currentClientScopedContext } from "../scoped-context.js";

/**
 * Brain: clients-specialist-update-contact
 * HITL: modifiche contatto (email/ruolo/primario) richiedono approvazione umana.
 */
export const updateClientContactTool = createTool({
  id: "update_client_contact",
  description:
    "Propone modifiche a un contatto del cliente attivo (email, ruolo, primario). " +
    "Richiede approvazione umana.",
  inputSchema: z.object({
    contactId: z.string().uuid(),
    changes: z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      role: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      isPrimary: z.boolean().optional(),
    }),
    reason: z.string().max(500),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.enum(["approved", "rejected"]),
    contact: z.record(z.unknown()).optional(),
  }),
  execute: async ({ context }) => {
    const ctx = currentClientScopedContext();
    const decision = await requestApproval({
      title: "Aggiornamento contatto",
      action: "update_client_contact",
      details: {
        contactId: context.contactId,
        changes: context.changes,
        reason: context.reason,
      },
    });
    if (decision === "reject") {
      return { ok: false, status: "rejected" as const };
    }
    const updated = await updateContact(
      { orgId: ctx.orgId, userId: ctx.userId, roles: ["member"] },
      context.contactId,
      context.changes,
    );
    return {
      ok: true,
      status: "approved" as const,
      contact: (updated ?? undefined) as Record<string, unknown> | undefined,
    };
  },
});
