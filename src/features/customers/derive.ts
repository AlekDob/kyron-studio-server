// Da ordini a clienti. Non esiste un'anagrafica clienti da nessuna parte: il
// cliente vive denormalizzato dentro l'ordine (email, nome, telefono, dati
// fiscali). Qui gli ordini di un periodo diventano una riga per persona,
// raggruppando sull'email in minuscolo.
//
// Funzioni pure: chi chiama porta gli ordini gia' letti e arricchiti, cosi'
// questo file si prova con `npx tsx derive.check.ts` senza rete.
import type { EnrichedOrder } from "@/features/orders/enrich.js";
import { statusBucketOf } from "@/features/orders/query-fields.js";

/** Un cliente e' "nuovo" se il suo primo ordine sta dentro questa finestra. */
export const NEW_CUSTOMER_DAYS = 30;

export interface CustomerRow {
  email: string;
  name: string;
  phone: string;
  /** Indirizzo di fatturazione compatto dell'ordine piu' recente. */
  address: string;
  companyName: string;
  fiscalCode: string;
  vatNumber: string;
  studentName: string;
  /** Portali su cui ha comprato (slug + nome scuola). */
  portals: Array<{ slug: string; name: string }>;
  /** Email degli agenti dei portali su cui ha comprato. */
  agents: string[];
  /** Ordini validi: gli annullati non contano ne' qui ne' nello speso. */
  orders: number;
  canceled: number;
  totalSpent: number;
  currency: string;
  firstOrder: string; // ISO datetime
  lastOrder: string; // ISO datetime
  orderNumbers: string[];
  /** SKU + nome delle righe comprate, per la ricerca "chi ha preso un iPad". */
  products: string;
  isNew: boolean;
  isReturning: boolean;
}

function nameOf(o: EnrichedOrder): string {
  return o.customerName || o.userEmail;
}

// L'ordine piu' recente detta i dati di contatto: se il cliente ha cambiato
// telefono o indirizzo, quello buono e' l'ultimo che ci ha dato.
function contactFrom(latest: EnrichedOrder) {
  return {
    name: nameOf(latest),
    phone: latest.customerPhone,
    address: latest.customerAddress,
    companyName: latest.companyName,
    fiscalCode: latest.fiscalCode,
    vatNumber: latest.vatNumber,
    studentName: latest.studentName,
  };
}

function productsOf(orders: EnrichedOrder[]): string {
  const seen = new Set<string>();
  for (const o of orders) {
    for (const l of o.lines) seen.add(`${l.sku} ${l.name}`);
  }
  return Array.from(seen).join(" | ");
}

function daysBetween(from: string, to: Date): number {
  return (to.getTime() - new Date(from).getTime()) / 86_400_000;
}

function rowOf(orders: EnrichedOrder[], now: Date): CustomerRow {
  // Piu' recente in testa: i dati di contatto e la data di ultimo ordine
  // vengono da qui, il primo ordine dalla coda.
  const sorted = [...orders].sort((a, b) => (a.created < b.created ? 1 : -1));
  const latest = sorted[0];
  const valid = sorted.filter((o) => statusBucketOf(o) !== "annullati");
  const portals = new Map<string, string>();
  const agents = new Set<string>();
  for (const o of sorted) {
    portals.set(o.channelSlug, o.portalName);
    if (o.agent) agents.add(o.agent);
  }
  const firstOrder = sorted[sorted.length - 1].created;
  return {
    email: latest.userEmail.toLowerCase(),
    ...contactFrom(latest),
    portals: Array.from(portals, ([slug, name]) => ({ slug, name })),
    agents: Array.from(agents).sort(),
    orders: valid.length,
    canceled: sorted.length - valid.length,
    totalSpent: valid.reduce((sum, o) => sum + o.totalGross, 0),
    currency: latest.currency,
    firstOrder,
    lastOrder: latest.created,
    orderNumbers: sorted.map((o) => o.number),
    products: productsOf(sorted),
    isNew: daysBetween(firstOrder, now) <= NEW_CUSTOMER_DAYS,
    isReturning: valid.length > 1,
  };
}

/**
 * Gli ordini del periodo diventano clienti, dal piu' recente al piu' vecchio.
 * `exclude` sono le nostre mail di test (stessa env del report ordini).
 */
export function buildCustomers(
  orders: EnrichedOrder[],
  opts: { exclude?: string[]; now?: Date } = {},
): CustomerRow[] {
  const now = opts.now ?? new Date();
  const skip = (opts.exclude ?? []).map((e) => e.toLowerCase());
  const byEmail = new Map<string, EnrichedOrder[]>();
  for (const o of orders) {
    const email = o.userEmail.trim().toLowerCase();
    if (!email || skip.includes(email)) continue;
    const list = byEmail.get(email);
    if (list) list.push(o);
    else byEmail.set(email, [o]);
  }
  return Array.from(byEmail.values())
    .map((list) => rowOf(list, now))
    .sort((a, b) => (a.lastOrder < b.lastOrder ? 1 : -1));
}

/** Gli ordini di un cliente, dal piu' recente. Stessa regola di raggruppamento. */
export function ordersOfCustomer(orders: EnrichedOrder[], email: string): EnrichedOrder[] {
  const needle = email.trim().toLowerCase();
  return orders
    .filter((o) => o.userEmail.trim().toLowerCase() === needle)
    .sort((a, b) => (a.created < b.created ? 1 : -1));
}
