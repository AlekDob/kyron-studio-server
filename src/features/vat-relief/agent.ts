// Agente Agevolazioni (IVA 4% L.104). Stesso protocollo SSE/_ui degli altri
// agenti Studio (decision-015). SOLA PROPOSTA: nessun tool scrive su Saleor —
// approva/rifiuta restano bottoni che l'operatore clicca (money-path).
import { streamText, tool } from "ai";
import { z } from "zod";
import { resolveModel } from "@/features/settings/resolve-model.js";
import { fetchOrderByNumber } from "@/core/saleor/orders.js";
import { analyzeDocs } from "./analyze.js";
import { getUploads } from "./uploads.js";
import { AGENT_SYSTEM_PROMPT } from "./prompt.js";

interface AgentRunOptions {
  userEmail: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function* runVatReliefAgent(opts: AgentRunOptions) {
  void opts.userEmail;
  const { model } = await resolveModel("vat-relief", "default");

  const result = streamText({
    model,
    system: AGENT_SYSTEM_PROMPT,
    messages: opts.messages,
    maxSteps: 8,
    tools: {
      render_doc_uploader: tool({
        description:
          "Mostra il riquadro per caricare i documenti 104 (PDF o foto). Chiamalo ogni volta che servono documenti: mai descriverlo a parole.",
        parameters: z.object({
          orderNumber: z
            .string()
            .optional()
            .describe("numero ordine collegato, se l'utente lo ha detto"),
        }),
        execute: async ({ orderNumber }) => ({
          ready: true,
          _ui: {
            component: "DocUploader",
            props: { orderNumber: orderNumber ?? null },
            id: `up_${orderNumber ?? "free"}_${Math.random().toString(36).slice(2, 8)}`,
          },
        }),
      }),

      get_order: tool({
        description:
          "Legge un ordine per numero (es. '326'): cliente, prodotti, totale, stato della richiesta IVA agevolata. Sola lettura.",
        parameters: z.object({ orderNumber: z.string() }),
        execute: async ({ orderNumber }) => {
          const order = await fetchOrderByNumber(orderNumber.replace(/^#/, "").trim());
          if (!order) return { found: false, orderNumber };
          return {
            found: true,
            number: order.number,
            customerName: order.customerName || order.userEmail,
            fiscalCode: order.fiscalCode,
            companyName: order.companyName,
            channelName: order.channelName,
            totalGross: order.totalGross,
            vatReliefStatus: order.vatReliefStatus || "nessuna richiesta",
            vatOverride: order.vatOverride,
            lines: order.lines.map((l) => ({ name: l.name, quantity: l.quantity })),
            _ui: { component: "VatReliefCase", props: { order }, id: `case_${order.number}` },
          };
        },
      }),

      analyze_documents: tool({
        description:
          "Analizza i documenti caricati (id restituiti dall'uploader) e produce l'esito strutturato. Passa orderNumber se la pratica e' collegata a un ordine.",
        parameters: z.object({
          uploadIds: z.array(z.string()).min(1),
          orderNumber: z.string().optional(),
        }),
        execute: async ({ uploadIds, orderNumber }) => {
          const uploads = getUploads(uploadIds);
          if (uploads.length === 0) {
            return {
              error:
                "I documenti non sono piu' disponibili (scaduti dopo 30 minuti). Ricaricali per rifare il controllo.",
            };
          }
          const order = orderNumber
            ? await fetchOrderByNumber(orderNumber.replace(/^#/, "").trim())
            : null;
          const report = await analyzeDocs({ uploads, order });
          return {
            ...report,
            fileAnalizzati: uploads.map((u) => u.name),
            _ui: {
              component: "DocCheckReport",
              props: {
                report,
                files: uploads.map((u) => u.name),
                orderNumber: order?.number ?? null,
              },
              id: `rep_${uploadIds.join("").slice(0, 12)}`,
            },
          };
        },
      }),

      propose_decision: tool({
        description:
          "Mette davanti all'operatore i bottoni Approva/Rifiuta per la richiesta IVA agevolata di un ordine. NON decide: la scelta la fa la persona.",
        parameters: z.object({
          orderNumber: z.string(),
          suggerimento: z.enum(["approve", "reject"]),
          motivo: z.string().describe("una riga, senza dettagli clinici"),
        }),
        execute: async ({ orderNumber, suggerimento, motivo }) => {
          const clean = orderNumber.replace(/^#/, "").trim();
          const order = await fetchOrderByNumber(clean);
          if (!order) return { error: `Ordine ${clean} non trovato.` };
          return {
            orderNumber: order.number,
            suggerimento,
            motivo,
            _ui: {
              component: "VatReliefDecision",
              props: {
                orderId: order.id,
                orderNumber: order.number,
                totalGross: order.totalGross,
                currentStatus: order.vatReliefStatus,
                suggerimento,
                motivo,
              },
              id: `dec_${order.number}`,
            },
          };
        },
      }),
    },
  });

  yield* result.fullStream;
}
