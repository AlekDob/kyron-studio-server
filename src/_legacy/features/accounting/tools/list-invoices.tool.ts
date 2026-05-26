import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { invoicesStore } from "../store.js";
import { invoiceStatusSchema } from "../types.js";

export const listInvoicesTool = createTool({
  id: "list_invoices",
  description:
    "Elenca le fatture aziendali. Usa questo quando l'utente chiede di vedere, elencare, cercare o filtrare fatture. Supporta filtro per stato e limite numerico.",
  inputSchema: z.object({
    status: invoiceStatusSchema.optional().describe("Filtra per stato fattura"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  outputSchema: z.object({
    count: z.number(),
    invoices: z.array(z.any()),
  }),
  execute: async ({ context }) => {
    const all = await invoicesStore.list();
    const filtered = context.status
      ? all.filter((i) => i.status === context.status)
      : all;
    const limited = filtered.slice(0, context.limit);
    return { count: filtered.length, invoices: limited };
  },
});
