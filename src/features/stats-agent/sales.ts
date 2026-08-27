// Vendite reali per prodotto, da Saleor.
//
// PostHog non sa cosa e' stato venduto: order_completed porta solo numero
// ordine, totale e valuta (storefront/src/components/CheckoutSuccess.tsx).
// Chiedere "prodotti piu' venduti" a PostHog torna una colonna vuota, quindi
// Ada deve leggere le righe d'ordine Saleor, che sono il dato vero.
import { fetchOrdersForRange, type OrderSummary } from "@/core/saleor/orders.js";
import { excludedEmails } from "@/features/commesso/sales.js";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const shiftDays = (d: Date, days: number): Date =>
  new Date(d.getTime() - days * 86_400_000);

/** Stessi range predefiniti dei tool PostHog, tradotti in [from, to] UTC. */
export function rangeToDays(range: string): { from: string; to: string } {
  const now = new Date();
  const today = isoDay(now);
  if (range === "today") return { from: today, to: today };
  if (range === "yesterday") {
    const y = isoDay(shiftDays(now, 1));
    return { from: y, to: y };
  }
  if (range === "week") {
    // getUTCDay(): 0=domenica → lunedi' della settimana corrente.
    const shift = (now.getUTCDay() + 6) % 7;
    return { from: isoDay(shiftDays(now, shift)), to: today };
  }
  if (range === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  const days = Number(range.replace("d", "")) || 7;
  return { from: isoDay(shiftDays(now, days - 1)), to: today };
}

export interface ProductSalesRow {
  prodotto: string;
  sku: string;
  quantita: number;
  fatturato: number;
  ordini: number;
}

export interface ProductSales {
  from: string;
  to: string;
  orderCount: number;
  rows: ProductSalesRow[];
}

/** Aggregazione pura (esportata per i test): ordini Saleor -> righe per prodotto. */
export function aggregateByProduct(
  orders: OrderSummary[],
  exclude: string[],
  channelSlug?: string,
): { orderCount: number; rows: ProductSalesRow[] } {
  const by = new Map<string, ProductSalesRow>();
  let orderCount = 0;
  for (const o of orders) {
    if (o.status === "CANCELED") continue;
    if (exclude.includes(o.userEmail.toLowerCase())) continue;
    if (channelSlug && o.channelSlug !== channelSlug) continue;
    orderCount += 1;
    const seen = new Set<string>();
    for (const line of o.lines) {
      const key = line.name || line.sku || "sconosciuto";
      const row =
        by.get(key) ?? { prodotto: key, sku: line.sku, quantita: 0, fatturato: 0, ordini: 0 };
      row.quantita += line.quantity;
      row.fatturato = Math.round((row.fatturato + line.totalGross) * 100) / 100;
      if (!seen.has(key)) {
        row.ordini += 1;
        seen.add(key);
      }
      by.set(key, row);
    }
  }
  return {
    orderCount,
    rows: [...by.values()].sort((a, b) => b.quantita - a.quantita),
  };
}

/** Righe d'ordine aggregate per nome prodotto, ordinate per quantita'. */
export async function salesByProduct(
  range: string,
  channelSlug?: string,
): Promise<ProductSales> {
  const { from, to } = rangeToDays(range);
  const orders = await fetchOrdersForRange(from, to);
  return { from, to, ...aggregateByProduct(orders, excludedEmails(), channelSlug) };
}
