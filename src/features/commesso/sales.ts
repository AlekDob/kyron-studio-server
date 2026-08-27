// Vendite per SKU (totale e per canale) per il pannello Catalogo di Studio.
// Il magazzino Saleor non dice niente di utile a chi guarda il catalogo: quello
// che serve e' "quanto ha venduto questo prodotto, e su che portale".
// Query leggera dedicata: la ORDERS_QUERY del modulo Ordini porta indirizzi,
// metadata e transazioni che qui non servono.
import { saleorApiUrl } from "@/core/saleor/client.js";

export interface SkuSales {
  total: number;
  /** quantita' venduta per channelSlug */
  byChannel: Record<string, number>;
}

export interface CatalogSales {
  /** ISO datetime dell'aggregazione (per il "aggiornato alle" in UI) */
  updatedAt: string;
  /** ordini contati (esclusi test e annullati) */
  orderCount: number;
  bySku: Record<string, SkuSales>;
}

const SALES_QUERY = `
  query CatalogSales($first: Int!, $after: String) {
    orders(first: $first, after: $after) {
      edges {
        node {
          status
          userEmail
          channel { slug }
          lines { productSku quantity }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface SalesNode {
  status: string;
  userEmail: string | null;
  channel: { slug: string } | null;
  lines: Array<{ productSku: string | null; quantity: number }>;
}

interface SalesResponse {
  data?: { orders: { edges: Array<{ node: SalesNode }>; pageInfo: { hasNextPage: boolean; endCursor: string } } };
  errors?: Array<{ message: string }>;
}

// Stessa allowlist di esclusione del report giornaliero: gli ordini di test
// interni non sono vendite.
function excludedEmails(): string[] {
  return (
    process.env.ORDERS_REPORT_EXCLUDE_EMAILS ??
    "alekdobrohotov@gmail.com,gmail@alekdob.com"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function add(sales: CatalogSales, node: SalesNode): void {
  const channel = node.channel?.slug ?? "";
  for (const line of node.lines) {
    const sku = line.productSku;
    if (!sku) continue;
    const entry = (sales.bySku[sku] ??= { total: 0, byChannel: {} });
    entry.total += line.quantity;
    if (channel) {
      entry.byChannel[channel] = (entry.byChannel[channel] ?? 0) + line.quantity;
    }
  }
}

async function aggregate(): Promise<CatalogSales> {
  const token = process.env.SALEOR_APP_TOKEN;
  if (!token) throw new Error("SALEOR_APP_TOKEN missing");
  const exclude = excludedEmails();
  const sales: CatalogSales = {
    updatedAt: new Date().toISOString(),
    orderCount: 0,
    bySku: {},
  };
  let after: string | null = null;
  do {
    const res = await fetch(saleorApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: SALES_QUERY, variables: { first: 100, after } }),
    });
    if (!res.ok) throw new Error(`Saleor sales ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as SalesResponse;
    if (json.errors?.length) throw new Error(`Saleor sales: ${json.errors[0].message}`);
    const conn = json.data!.orders;
    for (const { node } of conn.edges) {
      if (node.status === "CANCELED") continue;
      if (exclude.includes((node.userEmail ?? "").toLowerCase())) continue;
      sales.orderCount += 1;
      add(sales, node);
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return sales;
}

// ponytail: cache in memoria, non su disco. Si azzera al redeploy e non e'
// condivisa tra istanze — accettabile, e' un contatore di vendite, non soldi.
const TTL_MS = 15 * 60 * 1000;
let cache: { at: number; value: CatalogSales } | null = null;

export async function getCatalogSales(): Promise<CatalogSales> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await aggregate();
  cache = { at: Date.now(), value };
  return value;
}
