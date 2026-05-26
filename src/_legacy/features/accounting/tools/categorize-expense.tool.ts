import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { invoicesStore } from "../store.js";
import { categorySchema } from "../types.js";
import { requestApproval } from "@/core/approvals/registry.js";

// Brain: m2-accounting-agent — HITL sulle sole azioni write
export const categorizeExpenseTool = createTool({
  id: "categorize_expense",
  description:
    "Categorizza una fattura in una categoria di spesa. IMPORTANTE: richiede approvazione umana tramite carta di conferma — non eseguire senza autorizzazione dell'utente.",
  inputSchema: z.object({
    invoiceId: z.string().describe("ID univoco fattura, es. '23/B'"),
    category: categorySchema,
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    status: z.enum(["approved", "rejected", "not_found"]),
    invoice: z.any().optional(),
  }),
  execute: async ({ context }) => {
    const inv = await invoicesStore.findById(context.invoiceId);
    if (!inv) {
      return { ok: false, status: "not_found" as const };
    }

    const decision = await requestApproval({
      title: `Conferma categorizzazione fattura ${inv.id}`,
      action: "categorize_expense",
      details: {
        invoiceId: inv.id,
        supplier: inv.supplier,
        amount: inv.amount,
        currency: inv.currency,
        currentStatus: inv.status,
        proposedCategory: context.category,
      },
    });

    if (decision === "reject") {
      return { ok: false, status: "rejected" as const };
    }

    const updated = await invoicesStore.updateCategory(
      context.invoiceId,
      context.category,
    );
    return { ok: true, status: "approved" as const, invoice: updated };
  },
});
