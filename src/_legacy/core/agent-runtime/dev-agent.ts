import { invoicesStore } from "@/features/accounting/store.js";
import { categorySchema, invoiceStatusSchema } from "@/features/accounting/types.js";
import { requestApproval } from "@/core/approvals/registry.js";
import type { ChatMessage } from "./types.js";

/**
 * Dev agent rule-based: capisce 3 pattern senza LLM.
 * Permette test e2e completo (HITL incluso) senza ANTHROPIC_API_KEY.
 * Brain: m2-accounting-agent
 */

interface Sink {
  emitText: (s: string) => void;
}

async function typeOut(sink: Sink, text: string): Promise<void> {
  for (const token of text.split(/(\s+)/)) {
    await new Promise((r) => setTimeout(r, 10));
    sink.emitText(token);
  }
}

function euro(n: number): string {
  return `${n.toFixed(2)} €`;
}

async function handleList(sink: Sink, input: string): Promise<void> {
  const statusMatch = invoiceStatusSchema.options.find((s) =>
    input.toLowerCase().includes(s.replace("_", " ")),
  );
  const all = await invoicesStore.list();
  const filtered = statusMatch ? all.filter((i) => i.status === statusMatch) : all;
  const limited = filtered.slice(0, 10);

  const header = statusMatch
    ? `Ecco le fatture con stato **${statusMatch}** (${filtered.length} totali, ne mostro max 10):\n\n`
    : `Ecco le fatture recenti (${filtered.length} totali, ne mostro max 10):\n\n`;

  let table = "| ID | Fornitore | Importo | Scadenza | Stato |\n";
  table += "|----|-----------|--------:|----------|-------|\n";
  for (const inv of limited) {
    table += `| ${inv.id} | ${inv.supplier} | ${euro(inv.amount)} | ${inv.due_at} | ${inv.status} |\n`;
  }

  await typeOut(sink, header + table);
}

async function handleCategorize(sink: Sink, input: string): Promise<void> {
  const idMatch = input.match(/\b(\d{1,3}\/[A-Z])\b/);
  const catMatch = categorySchema.options.find((c) =>
    input.toLowerCase().includes(c.replace("_", " ")),
  );
  if (!idMatch || !catMatch) {
    await typeOut(
      sink,
      "Per categorizzare una fattura serve ID (es. `23/B`) e categoria (`office_supplies`, `travel`, `software`, `consulting`, `utilities`, `other`). Esempio: 'categorizza 23/B come software'.",
    );
    return;
  }
  const invoiceId = idMatch[1]!;
  const inv = await invoicesStore.findById(invoiceId);
  if (!inv) {
    await typeOut(sink, `Non trovo la fattura **${invoiceId}**. Verifica l'ID.`);
    return;
  }

  await typeOut(
    sink,
    `Sto per categorizzare **${invoiceId}** (${inv.supplier}, ${euro(inv.amount)}) come **${catMatch}**. Attendo la tua conferma...`,
  );

  const decision = await requestApproval({
    title: `Conferma categorizzazione fattura ${invoiceId}`,
    action: "categorize_expense",
    details: {
      invoiceId,
      supplier: inv.supplier,
      amount: inv.amount,
      currency: inv.currency,
      currentStatus: inv.status,
      proposedCategory: catMatch,
    },
  });

  if (decision === "reject") {
    await typeOut(sink, `\n\nHo annullato la categorizzazione di ${invoiceId}.`);
    return;
  }

  const updated = await invoicesStore.updateCategory(invoiceId, catMatch);
  await typeOut(
    sink,
    `\n\nFatto: **${invoiceId}** ora e' categorizzata come **${updated.category}** e approvata.`,
  );
}

async function handleReport(sink: Sink, input: string): Promise<void> {
  const monthNames: Record<string, number> = {
    gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
    luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  };
  const lower = input.toLowerCase();
  const monthName = Object.keys(monthNames).find((m) => lower.includes(m));
  const month = monthName ? monthNames[monthName]! : 3;
  const year = 2026;

  const all = await invoicesStore.list();
  const inMonth = all.filter((i) => {
    const d = new Date(i.issued_at);
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
  });

  const byCategory: Record<string, { total: number; count: number }> = {};
  for (const inv of inMonth) {
    const key = inv.category ?? "uncategorized";
    const b = byCategory[key] ?? { total: 0, count: 0 };
    b.total += inv.amount;
    b.count += 1;
    byCategory[key] = b;
  }

  const total = inMonth.reduce((s, i) => s + i.amount, 0);
  let out = `Riepilogo spese **${monthName ?? "marzo"} ${year}** — ${inMonth.length} fatture, totale **${euro(total)}**.\n\n`;
  out += "| Categoria | Fatture | Totale |\n|-----------|--------:|-------:|\n";
  for (const [cat, b] of Object.entries(byCategory)) {
    out += `| ${cat} | ${b.count} | ${euro(b.total)} |\n`;
  }

  await typeOut(sink, out);
}

export async function runDevAgent(
  messages: ChatMessage[],
  sink: Sink,
): Promise<void> {
  const last = messages[messages.length - 1]?.content ?? "";
  const lower = last.toLowerCase();

  if (/categorizz|classifica/i.test(lower)) {
    await handleCategorize(sink, last);
    return;
  }
  if (/report|riepilog|totale|mens/i.test(lower)) {
    await handleReport(sink, last);
    return;
  }
  if (/fattur|pending|approv|paga|scad/i.test(lower)) {
    await handleList(sink, last);
    return;
  }

  await typeOut(
    sink,
    [
      "Ciao! Sono l'assistente Contabilita' (modalita' dev senza LLM).",
      "Posso aiutarti con 3 cose:",
      "",
      "- **Elencare fatture**: 'mostrami le fatture pending'",
      "- **Categorizzare una spesa**: 'categorizza 23/B come software'",
      "- **Report mensile**: 'riepilogo spese di marzo'",
      "",
      "Per l'agente Claude reale, imposta `ANTHROPIC_API_KEY` nel server.",
    ].join("\n"),
  );
}
