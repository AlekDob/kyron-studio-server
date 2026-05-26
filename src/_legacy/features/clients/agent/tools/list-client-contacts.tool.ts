import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listContactsForClient } from "@/features/clients/store/contacts.store.js";
import { currentClientScopedContext } from "../scoped-context.js";

/**
 * Brain: clients-specialist-list-contacts
 * Read-only: restituisce i contatti associati al cliente attivo.
 */
export const listClientContactsTool = createTool({
  id: "list_client_contacts",
  description:
    "Restituisce i contatti associati al cliente attivo (nome, email, ruolo).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    items: z.array(z.record(z.unknown())),
  }),
  execute: async () => {
    const ctx = currentClientScopedContext();
    const items = await listContactsForClient(
      { orgId: ctx.orgId, userId: ctx.userId, roles: ["member"] },
      ctx.clientId,
    );
    return { items: items as unknown as Record<string, unknown>[] };
  },
});
