import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getClient } from "@/features/clients/store/clients.store.js";
import { requireAnalystTenantCtx } from "./search-clients.tool.js";

export const getClientProfileByIdTool = createTool({
  id: "get_client_profile_by_id",
  description:
    "Restituisce la scheda anagrafica completa di UN cliente specifico tramite il suo ID. " +
    "Usalo per drill-down quando l'utente chiede dettagli su un cliente della lista.",
  inputSchema: z.object({
    clientId: z.string().uuid(),
  }),
  outputSchema: z.object({
    client: z.record(z.unknown()).nullable(),
  }),
  execute: async ({ context }) => {
    const tenantCtx = requireAnalystTenantCtx();
    const client = await getClient(tenantCtx, context.clientId);
    return { client: client as Record<string, unknown> | null };
  },
});
