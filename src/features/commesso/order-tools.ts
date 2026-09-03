// Tool ordini di Nico. Sola lettura + cambio stato lavorazione: i money-path
// (bonifico incassato, carta del docente, override IVA, edit righe) restano
// sul pannello Ordini con le loro guardie, fuori dalla portata dell'agente.
import { tool } from "ai";
import { z } from "zod";
import {
  fetchOrderByNumber,
  fetchOrdersForRange,
  setOrderMeta,
  type OrderSummary,
} from "@/core/saleor/orders.js";
import { buildPortalIndex, enrichOrder, type PortalMeta } from "@/features/orders/enrich.js";
import { querySpecSchema } from "@/core/query/spec.js";
import { fieldHints, splitSimpleFilters } from "@/features/orders/spec-simple.js";
import {
  bucketTotals,
  filterOptions,
  filterOrders,
  ORDER_FIELD_NAMES,
} from "@/features/orders/query-fields.js";
import { excludedEmails } from "./sales.js";
import { isWorkflowStatus, setWorkflowStatus, WORKFLOW_STATUSES } from "@/features/orders/status.js";
import { listForOrder } from "@/features/orders/email-log.js";
import { safe } from "./tool-safe.js";

// Le sezioni della scheda ordine nel pannello (studio: orders-filter.ts).
// L'agente puo' portare l'operatore direttamente su quella giusta.
const ORDER_TAB = z.enum(["cliente", "pagamento", "prodotti", "note"]);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato YYYY-MM-DD");

// Il contesto del modello non regge le righe di 500 ordini: in lista si manda
// solo l'intestazione. Le righe si vedono con get_order.
function slimOrder(o: ReturnType<typeof enrichOrder>) {
  const { lines: _l, ...rest } = o;
  void _l;
  return rest;
}

async function portalIndex(): Promise<Map<string, PortalMeta>> {
  try {
    return await buildPortalIndex();
  } catch {
    // Payload giu' non deve far fallire la lista: si degrada senza agente/meccanografico.
    return new Map();
  }
}

async function loadOrders(from: string, to: string): Promise<OrderSummary[]> {
  const exclude = excludedEmails();
  const orders = await fetchOrdersForRange(from, to);
  return orders.filter((o) => !exclude.includes(o.userEmail.toLowerCase()));
}

export const orderTools = {
  list_orders: tool({
    description: [
      "Filtra la lista ordini del pannello a fianco e ne torna il conteggio.",
      "La lista in pagina si riallinea da sola: NON ripetere le righe in chat.",
      "Il filtro si compone con `spec`: `all` = condizioni in AND, `any` = in OR.",
      "Ogni condizione ha SEMPRE le tre chiavi `field`, `op`, `value`:",
      '{"field":"totale","op":"gte","value":600}. Mai {"totale":"gte"}.',
      `Valori di \`field\`: ${ORDER_FIELD_NAMES.join(", ")}.`,
      'Valori di `op`: eq, ne, gt, gte, lt, lte, contains, in, between, empty, notEmpty.',
      'Valori di `stato`: confermati | da-confermare | annullati.',
      'Valori di `metodoPagamento`: card | bank-transfer | teacher-card.',
      "Il campo `portale` e' uno slug tecnico: se la scuola te la nominano a parole usa `portaleNome` con `contains`.",
      "Ogni risposta porta `portaliDisponibili` e `agentiDisponibili` del periodo: sono gli unici valori validi, non inventarne altri.",
      "Un nome di persona e' ambiguo: puo' essere l'agente commerciale o il cliente. Se l'utente non lo dice, CHIEDIGLIELO prima di filtrare invece di sceglierne uno tu.",
      "Se la risposta torna `suggerimenti`, NON dire che non ci sono ordini: quel valore esiste su un altro campo, proponilo all'utente (es. \"ravelli non risulta tra i clienti, ma e' l'agente a.ravelli: filtro per agente?\").",
      'Esempio "sopra 600 euro non confermati di r.russo": {"all":[{"field":"totale","op":"gte","value":600},{"field":"stato","op":"eq","value":"da-confermare"},{"field":"agente","op":"eq","value":"r.russo"}]}.',
      'Esempio "con un iPad pagati con Carta del Docente": {"all":[{"field":"prodotti","op":"contains","value":"ipad"},{"field":"metodoPagamento","op":"eq","value":"teacher-card"}]}.',
      "Per le righe complete di un ordine usa get_order.",
    ].join(" "),
    parameters: z.object({
      from: DATE.describe("data inizio inclusa"),
      to: DATE.describe("data fine inclusa"),
      spec: querySpecSchema
        .optional()
        .describe("filtro strutturato; ometti per vedere tutto il periodo"),
    }),
    execute: safe(async ({ from, to, spec }) => {
      const index = await portalIndex();
      const all = (await loadOrders(from, to)).map((o) => enrichOrder(o, index));
      const orders = filterOrders(all, {}, spec);
      const totalGross = orders.reduce((s, o) => s + o.totalGross, 0);
      // Portali e agenti del periodo INTERO (non del set filtrato): senza,
      // l'agente tira a indovinare lo slug, prende zero righe e racconta che
      // non ci sono ordini. Vedi "portale = pbs" -> 0.
      const options = filterOptions(all);
      // La ricevuta accende i chip del pannello: quello che nella spec e' gia'
      // un filtro semplice (portale, agente, stato) esce da li' e diventa un
      // chip vero, il resto resta spec. Vedi spec-simple.ts.
      const simple = splitSimpleFilters(spec, options);
      return {
        from,
        to,
        count: orders.length,
        totalGross,
        buckets: bucketTotals(orders),
        portaliDisponibili: options.portals,
        agentiDisponibili: options.agents,
        // Presente solo con zero risultati: dice su quale altro campo quel
        // valore esiste davvero.
        ...(orders.length === 0 ? { suggerimenti: fieldHints(spec, options) } : {}),
        // ponytail: 40 righe al modello, il resto lo mostra il pannello.
        orders: orders.slice(0, 40).map(slimOrder),
        _ui: {
          component: "OrdersReceipt",
          props: {
            kind: "filter",
            filter: { from, to, query: "", ...simple },
            count: orders.length,
            totalGross,
          },
          id: `orders_${Date.now()}`,
        },
      };
    }),
    // Il descriptor serve solo al client: nel contesto del modello e' rumore.
    experimental_toToolResultContent: (r: unknown) => {
      const { _ui: _u, ...rest } = (r ?? {}) as Record<string, unknown>;
      void _u;
      return [{ type: "text" as const, text: JSON.stringify(rest) }];
    },
  }),

  get_order: tool({
    description:
      "Dettaglio di un ordine dal suo numero visibile (es. \"326\"): righe, cliente, pagamento, comunicazioni gia' inviate. Il pannello apre la scheda da solo. Con `tab` la apre gia' sulla sezione giusta.",
    parameters: z.object({
      number: z.string().describe("numero ordine, es. 326"),
      tab: ORDER_TAB.optional().describe("sezione da mostrare nella scheda"),
    }),
    execute: safe(async ({ number, tab }) => {
      const order = await fetchOrderByNumber(number);
      if (!order) return { found: false as const, number };
      const index = await portalIndex();
      const comms = await listForOrder(number).catch(() => []);
      const enriched = enrichOrder(order, index);
      return {
        found: true as const,
        order: enriched,
        comms,
        _ui: {
          component: "OrdersReceipt",
          props: {
            kind: "order",
            number: enriched.number,
            customer: enriched.customerName || enriched.companyName,
            portalName: enriched.portalName,
            totalGross: enriched.totalGross,
            tab,
          },
          id: `order_${enriched.number}`,
        },
      };
    }),
  }),

  add_order_note: tool({
    description:
      "Aggiunge una riga alla nota interna dell'ordine (visibile in Studio e nelle FootNotes dell'export Danea). Non manda niente al cliente. Non cancella quello che c'e' gia': accoda.",
    parameters: z.object({
      number: z.string().describe("numero ordine visibile, es. 326"),
      note: z.string().min(1).max(500).describe("riga da aggiungere, gia' scritta per un collega"),
    }),
    execute: safe(async ({ number, note }) => {
      const order = await fetchOrderByNumber(number);
      if (!order) return { found: false as const, number };
      // Accoda: la nota e' un campo unico condiviso con l'operatore, sovra-
      // scriverla perderebbe quello che ha scritto lui.
      const next = order.note ? `${order.note}\n${note}` : note;
      await setOrderMeta(order.id, "kyron_note", next);
      return {
        found: true as const,
        number: order.number,
        note: next,
        _ui: {
          component: "OrdersReceipt",
          props: {
            kind: "order",
            number: order.number,
            customer: order.customerName || order.companyName,
            totalGross: order.totalGross,
            tab: "note",
            refresh: true,
          },
          id: `order_note_${order.number}`,
        },
      };
    }),
  }),

  set_order_status: tool({
    description:
      "Cambia lo stato di lavorazione di un ordine. Con \"spedito\" parte la mail al cliente (una sola volta). Chiedi conferma prima.",
    parameters: z.object({
      orderId: z.string().describe("id Saleor dell'ordine (campo id di list_orders)"),
      status: z.enum(WORKFLOW_STATUSES),
      confirm: z.literal(true).describe("true solo dopo conferma esplicita dell'operatore"),
    }),
    execute: safe(async ({ orderId, status }) => {
      if (!isWorkflowStatus(status)) throw new Error(`Stato non valido: ${status}`);
      return setWorkflowStatus(orderId, status);
    }),
  }),
};
