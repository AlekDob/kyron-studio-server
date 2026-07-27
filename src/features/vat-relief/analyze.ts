// Analisi dei documenti per l'IVA agevolata 4% (L.104).
// Output STRUTTURATO (generateObject): l'esito non e' prosa libera, cosi' il
// client lo renderizza sempre uguale e la nota salvata su Saleor resta sintetica
// (mai diagnosi o dettagli clinici — vedi piano modulo Agevolazioni).
import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "@/features/settings/resolve-model.js";
import type { OrderSummary } from "@/core/saleor/orders.js";
import { CHECKLIST_104 } from "./prompt.js";
import type { StoredUpload } from "./uploads.js";

export const docCheckSchema = z.object({
  esito: z.enum(["ok", "incompleto", "errato"]),
  sintesi: z.string().describe("Una riga in italiano: cosa manca o perche' va bene."),
  documentiRilevati: z.array(
    z.object({
      tipo: z.string().describe("es. 'Verbale L.104 art.3', 'Carta d'identita''"),
      intestatario: z.string(),
      ente: z.string().nullable(),
      data: z.string().nullable(),
      leggibile: z.boolean(),
    }),
  ),
  problemi: z.array(
    z.object({
      cosa: z.string(),
      gravita: z.enum(["blocco", "attenzione"]),
    }),
  ),
  confrontoOrdine: z
    .object({
      intestatarioCoincide: z.boolean(),
      prodottiCoerenti: z.boolean(),
      note: z.string(),
    })
    .nullable(),
});

export type DocCheckResult = z.infer<typeof docCheckSchema>;

// I modelli senza visione non vedono i documenti: meglio un errore chiaro che
// un "tutto ok" inventato su allegati mai letti.
const VISION_BLOCKLIST = /^(o1-mini|o3-mini|gpt-3\.5|text-)/i;

function orderContext(order: OrderSummary): string {
  const lines = order.lines
    .map((l) => `- ${l.name} x${l.quantity}`)
    .join("\n");
  return [
    `ORDINE #${order.number} (${order.channelName})`,
    `Intestatario: ${order.customerName || order.userEmail}`,
    order.fiscalCode ? `Codice fiscale ordine: ${order.fiscalCode}` : "",
    order.companyName ? `Azienda/ente: ${order.companyName}` : "",
    `Totale: ${order.totalGross.toFixed(2)} ${order.currency}`,
    "Prodotti:",
    lines,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function analyzeDocs(input: {
  uploads: StoredUpload[];
  order: OrderSummary | null;
}): Promise<DocCheckResult> {
  if (input.uploads.length === 0) {
    throw new Error("Nessun documento da analizzare.");
  }
  const { model, modelId } = await resolveModel("vat-relief", "default");
  if (VISION_BLOCKLIST.test(modelId)) {
    throw new Error(
      `Il modello ${modelId} non legge documenti. Scegli un modello con visione (es. gpt-4o) in Impostazioni > Provider AI.`,
    );
  }

  const parts = input.uploads.map((u) =>
    u.mimeType === "application/pdf"
      ? ({ type: "file", data: u.bytes, mimeType: u.mimeType, filename: u.name } as const)
      : ({ type: "image", image: u.bytes, mimeType: u.mimeType } as const),
  );

  const intro = input.order
    ? `Valuta i documenti allegati per la richiesta di IVA agevolata 4% collegata a questo ordine.\n\n${orderContext(input.order)}`
    : "Valuta i documenti allegati per una richiesta di IVA agevolata 4%. NON e' collegata a nessun ordine: lascia confrontoOrdine a null.";

  const res = await generateObject({
    model,
    schema: docCheckSchema,
    system: CHECKLIST_104,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: intro }, ...parts],
      },
    ],
  });

  return res.object;
}
