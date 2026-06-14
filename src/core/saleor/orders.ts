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
  // Nome cliente (billing address, fallback user/email).
  customerName: string;
  customerPhone: string;
  // Indirizzo di fatturazione compatto ("via, CAP città") o vuoto.
  customerAddress: string;
  // Dati fiscali (da billingAddress.metadata del checkout). Vuoti se assenti.
  companyName: string;
  fiscalCode: string; // Codice fiscale
  vatNumber: string; // Partita IVA (solo B2B)
  sdiCode: string; // Codice destinatario SDI (solo B2B)
  totalGross: number;
  currency: string;
  // Stato evasione Saleor (UNFULFILLED, FULFILLED, CANCELED, ...).
  status: string;
  // Stato pagamento Saleor (FULLY_CHARGED, NOT_CHARGED, ...).
  paymentStatus: string;
  // Riferimento PSP della transazione (Stripe PaymentIntent pi_...) o vuoto.
  pspReference: string;
  lines: OrderLine[];
}

interface Address {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  streetAddress1: string | null;
  city: string | null;
  postalCode: string | null;
  companyName: string | null;
  metadata: Array<{ key: string; value: string }> | null;
}

interface OrderNode {
  number: string;
  created: string;
  userEmail: string | null;
  status: string | null;
  paymentStatus: string | null;
  user: { firstName: string | null; lastName: string | null } | null;
  billingAddress: Address | null;
  transactions: Array<{ pspReference: string | null }> | null;
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
          status
          paymentStatus
          user { firstName lastName }
          billingAddress { firstName lastName phone streetAddress1 city postalCode companyName metadata { key value } }
          transactions { pspReference }
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

// Nome cliente: billing address, fallback user, fallback email local-part.
function customerName(n: OrderNode): string {
  const full = (a: { firstName: string | null; lastName: string | null } | null) =>
    [a?.firstName, a?.lastName].filter(Boolean).join(" ").trim();
  return full(n.billingAddress) || full(n.user) || (n.userEmail ?? "").split("@")[0];
}

// Indirizzo fatturazione compatto: "via, CAP città" (parti vuote omesse).
function customerAddress(a: Address | null): string {
  if (!a) return "";
  const locality = [a.postalCode, a.city].filter(Boolean).join(" ");
  return [a.streetAddress1, locality].filter(Boolean).join(", ").trim();
}

// Riferimento Stripe: prima transazione con un pspReference valorizzato.
function pspReference(n: OrderNode): string {
  return n.transactions?.find((t) => t.pspReference)?.pspReference ?? "";
}

// Valore di un metadata fiscale dell'indirizzo di fatturazione (CF/P.IVA/SDI).
function billingMeta(a: Address | null, key: string): string {
  return a?.metadata?.find((m) => m.key === key)?.value ?? "";
}

function mapOrder(n: OrderNode): OrderSummary {
  return {
    number: n.number,
    created: n.created,
    channelSlug: n.channel?.slug ?? "unknown",
    channelName: n.channel?.name ?? n.channel?.slug ?? "Sconosciuto",
    userEmail: n.userEmail ?? "",
    customerName: customerName(n),
    customerPhone: n.billingAddress?.phone ?? "",
    customerAddress: customerAddress(n.billingAddress),
    companyName: n.billingAddress?.companyName ?? "",
    fiscalCode: billingMeta(n.billingAddress, "fiscalCode"),
    vatNumber: billingMeta(n.billingAddress, "vatNumber"),
    sdiCode: billingMeta(n.billingAddress, "sdiCode"),
    totalGross: n.total.gross.amount,
    currency: n.total.gross.currency,
    status: n.status ?? "",
    paymentStatus: n.paymentStatus ?? "",
    pspReference: pspReference(n),
    lines: n.lines.map((l) => ({
      sku: l.productSku ?? "",
      name: l.productName,
      quantity: l.quantity,
      totalGross: l.totalPrice.gross.amount,
    })),
  };
}

// Pagina tutti gli ordini che matchano un OrderFilterInput.created range,
// ordinati per numero. Pagina finche' hasNextPage. Helper condiviso da
// fetchOrdersForDay (giorno singolo) e fetchOrdersForRange (intervallo).
async function fetchOrders(gte: string, lte: string): Promise<OrderSummary[]> {
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
        variables: { filter: { created: { gte, lte } }, first: 100, after },
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

// Tutti gli ordini creati in una data (YYYY-MM-DD), ordinati per numero.
export async function fetchOrdersForDay(date: string): Promise<OrderSummary[]> {
  return fetchOrders(date, date);
}

// Tutti gli ordini creati nell'intervallo [from, to] (YYYY-MM-DD inclusivo).
// `created` e' un DateRangeInput (solo data), filtro per giorno UTC.
export async function fetchOrdersForRange(
  from: string,
  to: string,
): Promise<OrderSummary[]> {
  return fetchOrders(from, to);
}
