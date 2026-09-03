// Lettura clienti: l'unico posto che tocca la rete. La derivazione (derive.ts)
// e i filtri (query-fields.ts) restano puri e provabili.
import { fetchOrdersForRange } from "@/core/saleor/orders.js";
import { buildPortalIndex, enrichOrder, type EnrichedOrder, type PortalMeta } from "@/features/orders/enrich.js";
import { excludedEmails } from "@/features/commesso/sales.js";
import { listResendEmails, audienceOf } from "@/features/orders/resend-log.js";
import { listForEmail } from "@/features/orders/email-log.js";
import { buildCustomers, ordersOfCustomer, type CustomerRow } from "./derive.js";

/** Finestra di default: un anno. Un cliente si guarda sullo storico, non su 30 giorni. */
export const DEFAULT_DAYS = 365;

/** Data UTC YYYY-MM-DD a `days` giorni fa (0 = oggi). */
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Ordini del periodo, arricchiti col portale. Stessa degradazione di /orders:
 *  se Payload non risponde si perde agente e nome scuola, non la lista. */
export async function enrichedOrders(from: string, to: string): Promise<EnrichedOrder[]> {
  let index = new Map<string, PortalMeta>();
  try {
    index = await buildPortalIndex();
  } catch (e) {
    console.warn("[customers] portal index unavailable, continuing:", String(e));
  }
  return (await fetchOrdersForRange(from, to)).map((o) => enrichOrder(o, index));
}

export async function loadCustomers(from: string, to: string): Promise<{
  orders: EnrichedOrder[];
  customers: CustomerRow[];
}> {
  const orders = await enrichedOrders(from, to);
  return { orders, customers: buildCustomers(orders, { exclude: excludedEmails() }) };
}

export interface CustomerComm {
  id: string;
  campaign: string;
  subject: string;
  body: string;
  sentAt: string;
  delivery: string;
  audience: "cliente" | "interna";
}

/**
 * Tutto quello che abbiamo scritto a questo indirizzo. Due fonti come sulla
 * scheda ordine: Resend (stato di consegna reale, ~30 giorni) e il nostro
 * `email-log` su Payload (tiene il testo e sopravvive oltre i 30 giorni).
 * Una fonte giu' non azzera l'altra.
 */
export async function customerComms(email: string): Promise<CustomerComm[]> {
  const needle = email.trim().toLowerCase();
  const [logged, sent] = await Promise.allSettled([listForEmail(needle), listResendEmails()]);
  if (logged.status === "rejected") console.warn("[customers] email-log:", String(logged.reason));
  if (sent.status === "rejected") console.warn("[customers] resend:", String(sent.reason));
  const rows = logged.status === "fulfilled" ? logged.value : [];
  const mails =
    sent.status === "fulfilled"
      ? sent.value.filter((m) => m.to.some((r) => r.toLowerCase().includes(needle)))
      : [];

  const bodyBySubject = new Map(rows.map((r) => [String(r.subject ?? ""), String(r.body ?? "")]));
  const comms: CustomerComm[] = mails.map((m) => ({
    id: m.id,
    campaign: "",
    subject: m.subject,
    body: bodyBySubject.get(m.subject) ?? "",
    sentAt: m.sentAt,
    delivery: m.lastEvent,
    audience: audienceOf(m.to, needle),
  }));
  const seen = new Set(mails.map((m) => m.subject));
  for (const r of rows) {
    const subject = String(r.subject ?? "");
    if (seen.has(subject)) continue;
    comms.push({
      id: "",
      campaign: String(r.campaign ?? ""),
      subject,
      body: String(r.body ?? ""),
      sentAt: String(r.sentAt ?? ""),
      delivery: "",
      audience: "cliente",
    });
  }
  return comms.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
}

export { ordersOfCustomer };
