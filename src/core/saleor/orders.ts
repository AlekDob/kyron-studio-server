// Lettura ordini Saleor per il report giornaliero di Studio.
// A differenza del picker prodotti (query pubblica, client.ts) qui serve un App
// token con MANAGE_ORDERS e accesso globale ai channel: un admin staff con
// restrictedAccessToChannels vedrebbe 0 ordini (gotcha Danea export). Il token
// e' lo stesso usato dall'export Danea (SALEOR_APP_TOKEN).
import { saleorApiUrl } from "./client.js";

export interface OrderLine {
  sku: string;
  name: string; // productName Saleor
  quantity: number;
  totalGross: number;
}

export interface OrderSummary {
  number: string;
  created: string; // ISO datetime
  channelSlug: string;
  channelName: string;
  userEmail: string;
  totalGross: number;
  currency: string;
  lines: OrderLine[];
}

interface OrderNode {
  number: string;
  created: string;
  userEmail: string | null;
  channel: { slug: string; name: string } | null;
  total: { gross: { amount: number; currency: string } };
  lines: Array<{
    productName: string;
    variantName: string;
    productSku: string | null;
    quantity: number;
    totalPrice: { gross: { amount: number } };
  }>;
}

interface OrdersResponse {
  data?: { orders: { edges: Array<{ node: OrderNode }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
  errors?: Array<{ message: string }>;
}

// `created` e' un DateRangeInput (solo data): l'ordine viene filtrato sul giorno
// di creazione. Approssimazione UTC accettabile per un report "di ieri".
const ORDERS_QUERY = `
  query DailyOrders($filter: OrderFilterInput!, $first: Int!, $after: String) {
    orders(filter: $filter, first: $first, after: $after) {
      edges {
        node {
          number
          created
          userEmail
          channel { slug name }
          total { gross { amount currency } }
          lines {
            productName
            productSku
            quantity
            totalPrice { gross { amount } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function mapOrder(n: OrderNode): OrderSummary {
  return {
    number: n.number,
    created: n.created,
    channelSlug: n.channel?.slug ?? "unknown",
    channelName: n.channel?.name ?? n.channel?.slug ?? "Sconosciuto",
    userEmail: n.userEmail ?? "",
    totalGross: n.total.gross.amount,
    currency: n.total.gross.currency,
    lines: n.lines.map((l) => ({
      sku: l.productSku ?? "",
      name: l.productName,
      quantity: l.quantity,
      totalGross: l.totalPrice.gross.amount,
    })),
  };
}

// Tutti gli ordini creati in una data (YYYY-MM-DD), ordinati per numero.
// Pagina finche' hasNextPage (un giorno = poche decine di ordini).
export async function fetchOrdersForDay(date: string): Promise<OrderSummary[]> {
  const token = process.env.SALEOR_APP_TOKEN;
  if (!token) throw new Error("SALEOR_APP_TOKEN missing");
  const out: OrderSummary[] = [];
  let after: string | null = null;
  do {
    const res = await fetch(saleorApiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: ORDERS_QUERY,
        variables: { filter: { created: { gte: date, lte: date } }, first: 100, after },
      }),
    });
    if (!res.ok) throw new Error(`Saleor orders ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as OrdersResponse;
    if (json.errors?.length) throw new Error(`Saleor orders: ${json.errors[0].message}`);
    const conn = json.data!.orders;
    for (const { node } of conn.edges) out.push(mapOrder(node));
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return out.sort((a, b) => Number(a.number) - Number(b.number));
}
