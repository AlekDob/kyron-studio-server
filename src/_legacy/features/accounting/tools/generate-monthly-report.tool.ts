import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { invoicesStore } from "../store.js";
import type { Category, Invoice } from "../types.js";

function sameMonth(dateStr: string, year: number, month: number): boolean {
  const d = new Date(dateStr);
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
}

function aggregate(
  invoices: Invoice[],
): Record<string, { total: number; count: number }> {
  const out: Record<string, { total: number; count: number }> = {};
  for (const inv of invoices) {
    const key: Category | "uncategorized" = inv.category ?? "uncategorized";
    const bucket = out[key] ?? { total: 0, count: 0 };
    bucket.total += inv.amount;
    bucket.count += 1;
    out[key] = bucket;
  }
  return out;
}

export const generateMonthlyReportTool = createTool({
  id: "generate_monthly_report",
  description:
    "Genera un riepilogo spese mensile aggregato per categoria con confronto vs mese precedente. Usa quando l'utente chiede report, riepiloghi, totali mensili, analisi spese.",
  inputSchema: z.object({
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
  }),
  outputSchema: z.object({
    year: z.number(),
    month: z.number(),
    current: z.record(z.object({ total: z.number(), count: z.number() })),
    previous: z.record(z.object({ total: z.number(), count: z.number() })),
    totalCurrent: z.number(),
    totalPrevious: z.number(),
  }),
  execute: async ({ context }) => {
    const all = await invoicesStore.list();
    const prevMonth = context.month === 1 ? 12 : context.month - 1;
    const prevYear = context.month === 1 ? context.year - 1 : context.year;

    const currentInv = all.filter((i) =>
      sameMonth(i.issued_at, context.year, context.month),
    );
    const previousInv = all.filter((i) =>
      sameMonth(i.issued_at, prevYear, prevMonth),
    );

    const current = aggregate(currentInv);
    const previous = aggregate(previousInv);

    const totalCurrent = currentInv.reduce((s, i) => s + i.amount, 0);
    const totalPrevious = previousInv.reduce((s, i) => s + i.amount, 0);

    return {
      year: context.year,
      month: context.month,
      current,
      previous,
      totalCurrent,
      totalPrevious,
    };
  },
});
