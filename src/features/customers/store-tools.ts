// Tool di scrittura di Bea: la nota interna sul cliente e i segmenti salvati.
// Sono le uniche due cose che il modulo Clienti scrive (su Payload, feature 021).
import { tool } from "ai";
import { z } from "zod";
import { querySpecSchema } from "@/core/query/spec.js";
import { safe } from "@/features/commesso/tool-safe.js";
import { appendNote, listSegments, saveSegment } from "./store.js";

export function customerStoreTools(userEmail: string) {
  return {
    add_customer_note: tool({
      description:
        "Aggiunge una riga alla nota interna del cliente (visibile in Studio, sezione Note della scheda). Non manda niente al cliente. Non cancella quello che c'e' gia': accoda.",
      parameters: z.object({
        email: z.string().describe("email del cliente"),
        note: z.string().min(1).max(500).describe("riga da aggiungere, gia' scritta per un collega"),
      }),
      execute: safe(async ({ email, note }) => {
        const saved = await appendNote(email, note, userEmail);
        return {
          ok: true as const,
          email: saved.email,
          note: saved.note,
          _ui: {
            component: "CustomersReceipt",
            props: { kind: "customer", email: saved.email, name: "", tab: "note" },
            id: `custnote_${Date.now()}`,
          },
        };
      }),
    }),

    save_segment: tool({
      description:
        "Salva il filtro corrente come segmento riusabile, con un nome leggibile. Stesso nome = si aggiorna, non si duplica. Un segmento salvato si puo' poi usare come destinatari di una comunicazione.",
      parameters: z.object({
        name: z.string().min(2).max(60).describe("nome leggibile, es. 'Ricorrenti Massari'"),
        spec: querySpecSchema.describe("la stessa spec passata a list_customers"),
      }),
      execute: safe(async ({ name, spec }) => {
        const segment = await saveSegment({ name, spec, createdBy: userEmail });
        return { ok: true as const, segment };
      }),
    }),

    list_segments: tool({
      description: "I segmenti clienti salvati, con il loro slug. Usa lo slug per rifiltrare la lista o per scegliere i destinatari di una mail.",
      parameters: z.object({}),
      execute: safe(async () => ({ segments: await listSegments() })),
    }),
  };
}
