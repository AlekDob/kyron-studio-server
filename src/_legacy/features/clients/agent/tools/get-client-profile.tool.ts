import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getClient } from "@/features/clients/store/clients.store.js";
import { currentClientScopedContext } from "../scoped-context.js";

/**
 * Brain: clients-specialist-get-profile
 * Read-only: restituisce la scheda anagrafica completa del cliente attivo.
 */
export const getClientProfileTool = createTool({
  id: "get_client_profile",
  description:
    "Restituisce la scheda anagrafica completa del cliente attivo (nome, legalName, P.IVA, " +
    "stage, tags, metadata custom, health). Usalo quando hai bisogno di ricordare i dati di base.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    client: z.record(z.unknown()).nullable(),
  }),
  execute: async () => {
    const ctx = currentClientScopedContext();
    const client = await getClient(
      { orgId: ctx.orgId, userId: ctx.userId, roles: ["member"] },
      ctx.clientId,
    );
    return { client: client as Record<string, unknown> | null };
  },
});
