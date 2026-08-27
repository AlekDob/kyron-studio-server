// Tool ordini di Nico. Sola lettura + cambio stato lavorazione: i money-path
// (bonifico incassato, carta del docente, override IVA, edit righe) restano
// sul pannello Ordini con le loro guardie, fuori dalla portata dell'agente.
import { tool } from "ai";
import { z } from "zod";
import {
  fetchOrderByNumber,
  fetchOrdersForRange,
  type OrderSummary,
} from "@/core/saleor/orders.js";
import { buildPortalIndex, enrichOrder, type PortalMeta } from "@/features/orders/enrich.js";
import { excludedEmails } from "./sales.js";
import { isWorkflowStatus, setWorkflowStatus, WORKFLOW_STATUSES } from "@/features/orders/status.js";
import { listForOrder } from "@/features/orders/email-log.js";
import { safe } from "./tool-safe.js";

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
    description:
      "Elenca gli ordini Saleor creati in un intervallo di date. Esclude gli ordini di test. Senza righe: per quelle usa get_order.",
    parameters: z.object({
      from: DATE.describe("data inizio inclusa"),
      to: DATE.describe("data fine inclusa"),
      status: z.string().optional().describe(`stato lavorazione: ${WORKFLOW_STATUSES.join(", ")}`),
      portalSlug: z.string().optional().describe("slug del portale scuola"),
    }),
    execute: safe(async ({ from, to, status, portalSlug }) => {
      const index = await portalIndex();
      let orders = (await loadOrders(from, to)).map((o) => enrichOrder(o, index));
      if (portalSlug) orders = orders.filter((o) => o.channelSlug === portalSlug);
      if (status) orders = orders.filter((o) => o.workflowStatus === status);
      return {
        from,
        to,
        count: orders.length,
        totalGross: orders.reduce((s, o) => s + o.totalGross, 0),
        orders: orders.map(slimOrder),
      };
    }),
  }),

  get_order: tool({
    description:
      "Dettaglio di un ordine dal suo numero visibile (es. \"326\"): righe, cliente, pagamento, comunicazioni gia' inviate.",
    parameters: z.object({ number: z.string().describe("numero ordine, es. 326") }),
    execute: safe(async ({ number }) => {
      const order = await fetchOrderByNumber(number);
      if (!order) return { found: false as const, number };
      const index = await portalIndex();
      const comms = await listForOrder(number).catch(() => []);
      return { found: true as const, order: enrichOrder(order, index), comms };
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
