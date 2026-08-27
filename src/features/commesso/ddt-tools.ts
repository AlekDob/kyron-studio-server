// Tool DDT di Nico: leggere un export Danea di documenti e mandarne una
// comunicazione ai clienti. Il testo lo detta l'operatore in chat, Nico lo
// trasforma in oggetto + paragrafi. Niente template fisso.
import { tool } from "ai";
import { z } from "zod";
import { getDdtImport } from "./danea-uploads.js";
import { summarizeDocuments } from "./danea-ddt.js";
import { planDdtMailing, sendDdtMailing, sendDdtTestMail, BATCH_SIZE } from "@/features/orders/ddt-mailing.js";
import type { DdtCampaign } from "@/features/orders/ddt-mail-template.js";
import { safe } from "./tool-safe.js";

const CAMPAIGN = {
  campaignId: z
    .string()
    .regex(/^[a-z0-9-]{3,60}$/, "slug minuscolo, es. ritardi-agosto-2026")
    .describe("slug della campagna: e' il namespace anti-doppio-invio, non riusarlo per un'altra comunicazione"),
  subject: z.string().min(5).describe("oggetto della mail"),
  heading: z.string().min(3).describe("titolo dentro la mail"),
  paragraphs: z.array(z.string().min(1)).min(1).describe("corpo, un elemento per paragrafo"),
};

function campaignOf(a: { subject: string; heading: string; paragraphs: string[] }): DdtCampaign {
  return { subject: a.subject, heading: a.heading, paragraphs: a.paragraphs };
}

// Le anteprime HTML servono alla card, non al modello: nel contesto finirebbero
// migliaia di token di markup.
function slimPlan(p: Awaited<ReturnType<typeof planDdtMailing>>) {
  const { previews: _p, recipients, ...rest } = p;
  void _p;
  return { ...rest, recipients: recipients.slice(0, 5).map((r) => r.email) };
}

// Factory: serve l'email dell'operatore loggato per precompilare il campo
// "Invia una prova" nella card e per il tool di prova.
export function ddtTools(userEmail: string) {
  return {
    parse_ddt_summary: tool({
      description:
        "Riepiloga il file di DDT Danea caricato: quanti documenti, per portale, per metodo di pagamento, quanti senza email. Non manda niente.",
      parameters: z.object({ importId: z.string().describe("id restituito dall'uploader") }),
      execute: safe(async ({ importId }) => {
        const entry = getDdtImport(importId);
        return { importId, filename: entry.filename, ...summarizeDocuments(entry.documents) };
      }),
    }),

    plan_ddt_mailing: tool({
      description:
        "Prepara (senza inviare) la comunicazione ai clienti dei DDT caricati. Mostra oggetto, corpo, destinatari e anteprime. Chiamalo sempre prima di send_ddt_mailing.",
      parameters: z.object({ importId: z.string(), ...CAMPAIGN }),
      execute: safe(async (args) => {
        const plan = await planDdtMailing({
          importId: args.importId,
          campaignId: args.campaignId,
          campaign: campaignOf(args),
        });
        return {
          plan,
          batchSize: BATCH_SIZE,
          testTo: userEmail,
          _ui: {
            component: "DdtMailPlan",
            props: { plan, testTo: userEmail, importId: args.importId },
            id: `ddtmail_${Date.now()}`,
          },
        };
      }),
      experimental_toToolResultContent: (r: unknown) => {
        const res = r as {
          plan?: Awaited<ReturnType<typeof planDdtMailing>>;
          batchSize?: number;
          testTo?: string;
        };
        const out = res.plan
          ? { plan: slimPlan(res.plan), batchSize: res.batchSize, testTo: res.testTo }
          : r;
        return [{ type: "text" as const, text: JSON.stringify(out) }];
      },
    }),

    send_ddt_test_mail: tool({
      description:
        "Manda UNA mail di prova con la comunicazione, per default all'operatore loggato. Non intacca l'invio vero e funziona anche a invii disattivati. Usalo quando l'operatore chiede 'mandami una prova'.",
      parameters: z.object({
        importId: z.string(),
        ...CAMPAIGN,
        previewIndex: z.number().int().min(0).optional().describe("quale destinatario usare come esempio, 0 = il primo"),
        to: z.string().optional().describe("indirizzo di prova; vuoto = l'operatore loggato"),
      }),
      execute: safe(async (args) =>
        sendDdtTestMail({
          importId: args.importId,
          campaignId: args.campaignId,
          campaign: campaignOf(args),
          previewIndex: args.previewIndex ?? 0,
          to: args.to ?? userEmail,
        }),
      ),
    }),

    send_ddt_mailing: tool({
      description:
        `Invia davvero la comunicazione, al massimo ${BATCH_SIZE} destinatari per chiamata. Chiedi conferma esplicita prima. Se torna remaining > 0, richiamalo con gli stessi parametri per il lotto successivo.`,
      parameters: z.object({
        importId: z.string(),
        ...CAMPAIGN,
        confirm: z.literal(true).describe("true solo dopo che l'operatore ha approvato il piano"),
      }),
      execute: safe(async (args) =>
        sendDdtMailing({
          importId: args.importId,
          campaignId: args.campaignId,
          campaign: campaignOf(args),
        }),
      ),
    }),
  };
}
