import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getClient } from "@/features/clients/store/clients.store.js";
import { requireAnalystTenantCtx } from "./search-clients.tool.js";

// Brain: clients-analyst-focus
// Questo tool non "apre" davvero il cliente da codice — ritorna il clientId.
// La route analyst.route.ts intercetta il tool-result con toolName="focus_client"
// e scrive un evento SSE `client_focus` sul stream. Il client adapter reagisce
// chiamando useActiveClient.setClientId(id) → drill-down automatico UI.
export const focusClientTool = createTool({
  id: "focus_client",
  description:
    "Apre la cartella di UN cliente specifico nella colonna a destra della UI. " +
    "Usalo quando l'utente chiede di visualizzare/aprire/mostrare un cliente. " +
    "Richiede il clientId esatto (ottenibile da search_clients o aggregate_clients). " +
    "Dopo aver chiamato questo tool, suggerisci all'utente che la cartella e' stata aperta a destra.",
  inputSchema: z.object({
    clientId: z.string().uuid(),
    reason: z.string().max(300).describe("Motivo per cui stai aprendo questo cliente"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    clientId: z.string().nullable(),
    clientName: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    const tenantCtx = requireAnalystTenantCtx();
    const client = await getClient(tenantCtx, context.clientId);
    if (!client) {
      return {
        ok: false,
        clientId: null,
        clientName: null,
        reason: null,
      };
    }
    return {
      ok: true,
      clientId: client.id,
      clientName: client.name,
      reason: context.reason,
    };
  },
});
