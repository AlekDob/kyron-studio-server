import { Agent } from "@mastra/core/agent";
import type { LanguageModel } from "ai";
import { listInvoicesTool } from "./tools/list-invoices.tool.js";
import { categorizeExpenseTool } from "./tools/categorize-expense.tool.js";
import { generateMonthlyReportTool } from "./tools/generate-monthly-report.tool.js";
import { searchBrainTool } from "@/features/brain/tools/search-brain.tool.js";

// Brain: studio-futuro-mono
// Factory: l'agente non e' un singleton, viene costruito per request con il modello risolto
// dai settings (orgId, moduleId, processId). Cosi' ogni org ha il suo provider.
export function makeAccountingAgent(model: LanguageModel): Agent {
  return new Agent({
    name: "accounting",
    instructions: [
      "Sei l'assistente Contabilita' di Spaceship. Lavori con impiegati italiani non tecnici.",
      "RISPONDI SEMPRE IN ITALIANO, con tono cordiale, chiaro, professionale.",
      "Usa i tool a disposizione per rispondere su fatture, categorizzazioni e report mensili.",
      "Quando l'utente chiede di categorizzare una fattura: chiama `categorize_expense`. L'azione richiede conferma umana automatica — NON chiedere conferma tu stesso, il sistema la gestisce.",
      "Quando ricevi dati dai tool, presentali in modo leggibile: tabelle markdown per liste di fatture, elenchi per report.",
      "Se un tool fallisce (fattura non trovata, categoria invalida), spiega l'errore in modo semplice e suggerisci alternative.",
      "Non inventare mai dati: usa SEMPRE i tool per ottenere informazioni reali.",
      "Hai accesso al Brain aziendale tramite `search_brain`: usalo quando l'utente chiede policy interne (rimborsi, IVA fornitori, procedure). Cita sempre il documento sorgente.",
    ].join("\n"),
    model,
    tools: {
      list_invoices: listInvoicesTool,
      categorize_expense: categorizeExpenseTool,
      generate_monthly_report: generateMonthlyReportTool,
      search_brain: searchBrainTool,
    },
  });
}
