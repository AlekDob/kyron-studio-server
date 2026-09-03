// Tool di lettura di Bea. Stesso schema di Nico sugli ordini: il pannello a
// fianco e' la lista vera, in chat va solo la ricevuta. Sola lettura: le mail
// stanno in mail-tools.ts, le note e i segmenti nei loro.
import { tool } from "ai";
import { z } from "zod";
import { querySpecSchema } from "@/core/query/spec.js";
import { safe } from "@/features/commesso/tool-safe.js";
import { bucketTotals, filterCustomers, filterOptions, CUSTOMER_FIELD_NAMES } from "./query-fields.js";
import { DEFAULT_DAYS, customerComms, isoDaysAgo, loadCustomers, ordersOfCustomer } from "./service.js";
import { getSegment } from "./store.js";
import type { CustomerRow } from "./derive.js";

// Le sezioni della scheda cliente nel pannello (studio: customers-filter.ts).
const CUSTOMER_TAB = z.enum(["anagrafica", "ordini", "comunicazioni", "note"]);

const DAYS = z
  .number()
  .int()
  .min(1)
  .max(1095)
  .optional()
  .describe(`finestra storica in giorni, default ${DEFAULT_DAYS}`);

/** In chat va l'intestazione: i numeri d'ordine e i prodotti riempirebbero il contesto. */
function slim(c: CustomerRow) {
  const { orderNumbers: _n, products: _p, ...rest } = c;
  void _n;
  void _p;
  return rest;
}

const range = (days?: number) => ({ from: isoDaysAgo(days ?? DEFAULT_DAYS), to: isoDaysAgo(0) });

export const customerTools = {
  list_customers: tool({
    description: [
      "Filtra la lista clienti del pannello a fianco e ne torna il conteggio.",
      "La lista in pagina si riallinea da sola: NON ripetere le righe in chat.",
      "Un cliente e' chi ha ordinato: i dati arrivano dagli ordini del periodo.",
      "Il filtro si compone con `spec`: `all` = condizioni in AND, `any` = in OR.",
      "Ogni condizione ha SEMPRE le tre chiavi `field`, `op`, `value`:",
      '{"field":"speso","op":"gte","value":1000}.',
      `Valori di \`field\`: ${CUSTOMER_FIELD_NAMES.join(", ")}.`,
      "Valori di `op`: eq, ne, gt, gte, lt, lte, contains, in, between, empty, notEmpty.",
      "`nuovo` e `ricorrente` sono booleani: primo ordine negli ultimi 30 giorni, piu' di un ordine valido.",
      "Il campo `portale` e' uno slug tecnico e puo' contenerne piu' di uno: usa sempre `contains`, o `portaleNome` se la scuola te la nominano a parole.",
      "Ogni risposta porta `portaliDisponibili` e `agentiDisponibili`: sono gli unici valori validi, non inventarne altri.",
      'Esempio "clienti di massari che hanno speso piu\' di 1000 euro": {"all":[{"field":"portale","op":"contains","value":"massari"},{"field":"speso","op":"gt","value":1000}]}.',
      "Per la scheda completa di un cliente usa get_customer.",
    ].join(" "),
    parameters: z.object({
      days: DAYS,
      spec: querySpecSchema.optional().describe("filtro strutturato; ometti per vedere tutti i clienti"),
      segment: z
        .string()
        .optional()
        .describe("slug di un segmento salvato (list_segments): usa la sua query al posto di spec"),
    }),
    execute: safe(async ({ days, spec, segment }) => {
      const { from, to } = range(days);
      // Segmento salvato = spec gia' scritta: se c'e', vince su quella del turno.
      const saved = segment ? await getSegment(segment) : null;
      if (segment && !saved) throw new Error(`segmento "${segment}" non trovato`);
      const used = saved?.spec ?? spec;
      const { customers: all } = await loadCustomers(from, to);
      const customers = filterCustomers(all, {}, used);
      const options = filterOptions(all);
      return {
        from,
        to,
        count: customers.length,
        buckets: bucketTotals(customers),
        portaliDisponibili: options.portals,
        agentiDisponibili: options.agents,
        // ponytail: 40 righe al modello, il resto lo mostra il pannello.
        customers: customers.slice(0, 40).map(slim),
        _ui: {
          component: "CustomersReceipt",
          props: {
            kind: "filter",
            filter: { from, to, portal: "all", agent: "all", group: "all", query: "", spec: used ?? null },
            count: customers.length,
            totalSpent: customers.reduce((s, c) => s + c.totalSpent, 0),
          },
          id: `customers_${Date.now()}`,
        },
      };
    }),
    experimental_toToolResultContent: (r: unknown) => {
      const { _ui: _u, ...rest } = r as Record<string, unknown>;
      void _u;
      return [{ type: "text" as const, text: JSON.stringify(rest) }];
    },
  }),

  get_customer: tool({
    description:
      "Scheda di un cliente: anagrafica, ordini e comunicazioni gia' inviate. Apre anche la scheda nel pannello, sulla sezione richiesta.",
    parameters: z.object({
      email: z.string().describe("email del cliente, e' la sua identita'"),
      tab: CUSTOMER_TAB.optional().describe("sezione da aprire nel pannello"),
      days: DAYS,
    }),
    execute: safe(async ({ email, tab, days }) => {
      const { from, to } = range(days);
      const needle = email.trim().toLowerCase();
      const { orders, customers } = await loadCustomers(from, to);
      const customer = customers.find((c) => c.email === needle);
      if (!customer) return { found: false, message: `Nessun ordine da ${email} negli ultimi ${days ?? DEFAULT_DAYS} giorni.` };
      const comms = await customerComms(needle);
      return {
        found: true,
        customer,
        orders: ordersOfCustomer(orders, needle).map((o) => ({
          number: o.number,
          created: o.created,
          status: o.status,
          totalGross: o.totalGross,
          portalName: o.portalName,
        })),
        comms: comms.map(({ body: _b, ...c }) => {
          void _b;
          return c;
        }),
        _ui: {
          component: "CustomersReceipt",
          props: { kind: "customer", email: needle, name: customer.name, tab },
          id: `customer_${Date.now()}`,
        },
      };
    }),
  }),

  customer_orders: tool({
    description: "Solo gli ordini di un cliente, con le righe. Usalo quando ti chiedono cosa ha comprato.",
    parameters: z.object({ email: z.string(), days: DAYS }),
    execute: safe(async ({ email, days }) => {
      const { from, to } = range(days);
      const { orders } = await loadCustomers(from, to);
      const mine = ordersOfCustomer(orders, email.trim().toLowerCase());
      return { email, count: mine.length, orders: mine };
    }),
  }),
};
