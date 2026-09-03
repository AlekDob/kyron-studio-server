// Tool mail di Bea. Il motore d'invio e' lo STESSO di Nico
// (`core/email/campaign.ts`): qui cambia solo da dove arrivano i destinatari —
// non un file DDT, ma la lista clienti filtrata.
import { tool } from "ai";
import { z } from "zod";
import {
  planCampaign,
  sendCampaign,
  sendCampaignTestMail,
  assertMailEnabled,
  assertOneEmail,
  BATCH_SIZE,
  type CampaignPlan,
  type Recipient,
} from "@/core/email/campaign.js";
import { detailsBox, esc } from "@/core/email/campaign-template.js";
import type { Campaign } from "@/core/email/campaign-template.js";
import { safe } from "@/features/commesso/tool-safe.js";
import { DEFAULT_DAYS, isoDaysAgo, loadCustomers } from "./service.js";
import { filterCustomers, type FlatFilter } from "./query-fields.js";
import { getSegment } from "./store.js";
import type { QuerySpec } from "@/core/query/spec.js";
import type { CustomerRow } from "./derive.js";

const CAMPAIGN = {
  campaignId: z
    .string()
    .regex(/^[a-z0-9-]{3,60}$/, "slug minuscolo, es. rientro-scuola-2026")
    .describe("slug della campagna: e' il namespace anti-doppio-invio, non riusarlo per un'altra comunicazione"),
  subject: z.string().min(5).describe("oggetto della mail"),
  heading: z.string().min(3).describe("titolo dentro la mail"),
  paragraphs: z.array(z.string().min(1)).min(1).describe("corpo, un elemento per paragrafo"),
};

const AUDIENCE = {
  portal: z.string().optional().describe("slug portale, oppure 'all'"),
  agent: z.string().optional().describe("email agente, oppure 'all'"),
  group: z.enum(["nuovi", "ricorrenti"]).optional().describe("solo clienti nuovi (30gg) o ricorrenti"),
  q: z.string().optional().describe("ricerca libera su nome, email, telefono, scuola, numero ordine"),
  segment: z
    .string()
    .optional()
    .describe("slug di un segmento salvato (list_segments): la sua query si somma al filtro"),
  days: z.number().int().min(1).max(1095).optional().describe(`finestra storica in giorni, default ${DEFAULT_DAYS}`),
};

type Audience = { days?: number; segment?: string } & FlatFilter;

const campaignOf = (a: Campaign): Campaign => ({
  subject: a.subject,
  heading: a.heading,
  paragraphs: a.paragraphs,
});

/** Descrizione leggibile del pubblico: finisce nella card come "fonte" dei destinatari. */
function describe(a: Audience, count: number): string {
  const bits = [
    a.group ?? "clienti",
    a.portal && a.portal !== "all" ? `portale ${a.portal}` : "",
    a.agent && a.agent !== "all" ? `agente ${a.agent}` : "",
    a.q ? `"${a.q}"` : "",
    a.segment ? `segmento ${a.segment}` : "",
    `ultimi ${a.days ?? DEFAULT_DAYS} giorni`,
  ].filter(Boolean);
  return `${count} clienti — ${bits.join(", ")}`;
}

/** Il riquadro grigio del cliente: l'ultimo ordine, cosi' riconosce di cosa parliamo. */
function customerDetails(c: CustomerRow): string {
  if (!c.orderNumbers.length) return "";
  return detailsBox([`Ultimo ordine <strong>#${esc(c.orderNumbers[0])}</strong> del ${esc(c.lastOrder.slice(0, 10))}`]);
}

const recipientOf = (c: CustomerRow): Recipient => ({
  // La chiave e' l'email: una sola mail per cliente per campagna.
  key: c.email,
  email: c.email,
  name: c.name,
  orderNumber: c.orderNumbers[0] ?? "",
  group: c.portals[0]?.slug ?? "",
  matched: true,
  detailsHtml: customerDetails(c),
});

/** La spec di un segmento salvato. Slug sconosciuto = errore, non "tutti i
 *  clienti": mandare a tutti per una svista e' il danno peggiore qui. */
async function segmentSpec(slug: string | undefined): Promise<QuerySpec | undefined> {
  if (!slug) return undefined;
  const segment = await getSegment(slug);
  if (!segment) throw new Error(`segmento "${slug}" non trovato`);
  return segment.spec;
}

async function customerPlan(args: Audience & { campaignId: string } & Campaign): Promise<CampaignPlan> {
  const spec = await segmentSpec(args.segment);
  const { customers } = await loadCustomers(isoDaysAgo(args.days ?? DEFAULT_DAYS), isoDaysAgo(0));
  const picked = filterCustomers(
    customers,
    { portal: args.portal, agent: args.agent, group: args.group, q: args.q },
    spec,
  );
  return planCampaign({
    source: describe(args, picked.length),
    campaignId: args.campaignId,
    campaign: campaignOf(args),
    recipients: picked.map(recipientOf),
  });
}

// Le anteprime HTML servono alla card, non al modello: nel contesto finirebbero
// migliaia di token di markup.
function slimPlan(p: CampaignPlan) {
  const { previews: _p, recipients, ...rest } = p;
  void _p;
  return { ...rest, recipients: recipients.slice(0, 5).map((r) => r.email) };
}

export function customerMailTools(userEmail: string) {
  return {
    plan_customer_mailing: tool({
      description:
        "Prepara (senza inviare) una comunicazione ai clienti selezionati dal filtro. Mostra oggetto, corpo, destinatari e anteprime. Chiamalo sempre prima di send_customer_mailing.",
      parameters: z.object({ ...AUDIENCE, ...CAMPAIGN }),
      execute: safe(async (args) => {
        const plan = await customerPlan(args);
        return {
          plan,
          batchSize: BATCH_SIZE,
          testTo: userEmail,
          _ui: {
            component: "DdtMailPlan",
            props: { plan, testTo: userEmail, audience: audienceOf(args) },
            id: `custmail_${Date.now()}`,
          },
        };
      }),
      experimental_toToolResultContent: (r: unknown) => {
        const res = r as { plan?: CampaignPlan; batchSize?: number; testTo?: string };
        const out = res.plan ? { plan: slimPlan(res.plan), batchSize: res.batchSize, testTo: res.testTo } : r;
        return [{ type: "text" as const, text: JSON.stringify(out) }];
      },
    }),

    send_customer_test_mail: tool({
      description:
        "Manda UNA mail di prova con la comunicazione, per default all'operatore loggato. Non intacca l'invio vero e funziona anche a invii disattivati.",
      parameters: z.object({
        ...AUDIENCE,
        ...CAMPAIGN,
        previewIndex: z.number().int().min(0).optional().describe("quale cliente usare come esempio, 0 = il primo"),
        to: z.string().optional().describe("indirizzo di prova; vuoto = l'operatore loggato"),
      }),
      execute: safe(async (args) => {
        const to = assertOneEmail(args.to ?? userEmail);
        const plan = await customerPlan(args);
        return sendCampaignTestMail({ plan, previewIndex: args.previewIndex ?? 0, to });
      }),
    }),

    send_customer_mailing: tool({
      description: `Invia davvero la comunicazione ai clienti, al massimo ${BATCH_SIZE} destinatari per chiamata. Chiedi conferma esplicita prima. Se torna remaining > 0, richiamalo con gli stessi parametri per il lotto successivo.`,
      parameters: z.object({
        ...AUDIENCE,
        ...CAMPAIGN,
        confirm: z.literal(true).describe("true solo dopo che l'operatore ha approvato il piano"),
      }),
      execute: safe(async (args) => {
        assertMailEnabled();
        return sendCampaign({ plan: await customerPlan(args) });
      }),
    }),
  };
}

/** Filtro da rimettere nella card, cosi' il bottone "Invia prova" sa a chi si riferisce. */
function audienceOf(a: Audience): Audience {
  return { portal: a.portal, agent: a.agent, group: a.group, q: a.q, days: a.days, segment: a.segment };
}
