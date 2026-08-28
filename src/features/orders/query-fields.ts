// Mappa campi degli ordini per il motore di query (core/query/spec.ts) + la
// SOLA statusBucketOf del progetto. Prima ne esistevano tre copie (route, tool
// di Nico, pannello): quando divergevano, i conteggi in chat e i KPI in pagina
// non tornavano. Ora il conteggio si fa qui e basta.
import type { FieldMap, QuerySpec } from "@/core/query/spec.js";
import { applySpec } from "@/core/query/spec.js";
import type { EnrichedOrder } from "./enrich.js";

export const STATUS_BUCKETS = [
  "confermati",
  "da-confermare",
  "annullati",
] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

/** Priorita': annullato -> bozza -> confermato. */
export function statusBucketOf(o: EnrichedOrder): StatusBucket {
  if (o.workflowStatus === "annullato" || o.status === "CANCELED") return "annullati";
  if (o.status === "UNCONFIRMED" || o.status === "DRAFT") return "da-confermare";
  return "confermati";
}

/** Local-part dell'email agente: e' l'etichetta che si vede nel select in pagina. */
export function agentLabel(email: string): string {
  return email ? email.split("@")[0] : "";
}

// Metodo di pagamento leggibile. Un ordine misto (buono + residuo) resta
// "carta-docente": e' il buono a decidere come si lavora l'ordine.
function paymentMethodOf(o: EnrichedOrder): string {
  if (o.paymentMethod) return o.paymentMethod;
  return o.pspReference ? "card" : "";
}

// Righe dell'ordine appiattite: SKU + nome prodotto. Serve a "ordini che
// contengono un iPad" senza dover caricare le righe una per una.
function productsOf(o: EnrichedOrder): string {
  return o.lines.map((l) => `${l.sku} ${l.name}`).join(" | ");
}

export const ORDER_FIELDS: FieldMap<EnrichedOrder> = {
  numero: (o) => o.number,
  cliente: (o) => o.customerName,
  azienda: (o) => o.companyName,
  email: (o) => o.userEmail,
  telefono: (o) => o.customerPhone,
  citta: (o) => o.customerAddress,
  stato: (o) => statusBucketOf(o),
  statoLavorazione: (o) => o.workflowStatus,
  statoSaleor: (o) => o.status,
  statoPagamento: (o) => o.paymentStatus,
  metodoPagamento: paymentMethodOf,
  portale: (o) => o.channelSlug,
  portaleNome: (o) => o.portalName,
  agente: (o) => agentLabel(o.agent),
  agenteEmail: (o) => o.agent,
  totale: (o) => o.totalGross,
  data: (o) => o.created.slice(0, 10),
  ora: (o) => o.created.slice(11, 16),
  codiceMeccanografico: (o) => o.codiceMeccanografico,
  note: (o) => o.note,
  stripe: (o) => o.pspReference,
  prodotti: productsOf,
  ivaAgevolata: (o) => o.vatReliefStatus,
  cartaDocente: (o) => o.teacherCardAmount !== null,
  cartaDocenteAcquisita: (o) => o.teacherCardAcquired,
  bonificoIncassato: (o) => o.bankTransferPaid,
};

/** Elenco campi per la description del tool e per i messaggi d'errore. */
export const ORDER_FIELD_NAMES = Object.keys(ORDER_FIELDS);

// Campi su cui pesca la barra di ricerca del pannello.
const SEARCH_FIELDS = [
  "numero",
  "cliente",
  "azienda",
  "email",
  "telefono",
  "stripe",
] as const;

export interface FlatFilter {
  portal?: string;
  agent?: string;
  status?: string;
  q?: string;
}

/**
 * I quattro filtri "semplici" del pannello diventano condizioni dello stesso
 * motore. Cosi' non esiste un secondo percorso di filtraggio da tenere allineato.
 */
export function flatToSpec(flat: FlatFilter, base?: QuerySpec): QuerySpec {
  const all = [...(base?.all ?? [])];
  const any = [...(base?.any ?? [])];
  if (flat.portal && flat.portal !== "all") {
    all.push({ field: "portale", op: "eq", value: flat.portal });
  }
  if (flat.agent && flat.agent !== "all") {
    all.push({ field: "agente", op: "eq", value: agentLabel(flat.agent) });
  }
  if (flat.status && flat.status !== "all") {
    all.push({ field: "stato", op: "eq", value: flat.status });
  }
  const needle = flat.q?.trim();
  if (needle) {
    // La ricerca libera e' un OR: se `any` era gia' occupato dall'agente si
    // aggiunge in AND come gruppo separato, ma qui basta l'OR semplice.
    for (const f of SEARCH_FIELDS) any.push({ field: f, op: "contains", value: needle });
  }
  return { all, any, sort: base?.sort };
}

export interface Bucket {
  count: number;
  eur: number;
}
export type Buckets = Record<"all" | StatusBucket, Bucket>;

/**
 * KPI per stato. Si calcolano sul set filtrato da tutto TRANNE lo stato: e'
 * quello che vede l'operatore quando clicca una tile per restringere.
 */
export function bucketTotals(orders: EnrichedOrder[]): Buckets {
  const empty = (): Bucket => ({ count: 0, eur: 0 });
  const out: Buckets = {
    all: empty(),
    confermati: empty(),
    "da-confermare": empty(),
    annullati: empty(),
  };
  for (const o of orders) {
    const b = out[statusBucketOf(o)];
    b.count++;
    b.eur += o.totalGross;
    out.all.count++;
    out.all.eur += o.totalGross;
  }
  return out;
}

/** Filtro completo: spec dell'agente + filtri piatti del pannello. */
export function filterOrders(
  orders: EnrichedOrder[],
  flat: FlatFilter,
  spec?: QuerySpec,
): EnrichedOrder[] {
  return applySpec(orders, flatToSpec(flat, spec), ORDER_FIELDS);
}

/** Opzioni dei select del pannello: da TUTTO il periodo, non dal set filtrato. */
export function filterOptions(orders: EnrichedOrder[]): {
  portals: Array<{ slug: string; name: string }>;
  agents: string[];
} {
  const portals = new Map<string, string>();
  const agents = new Set<string>();
  for (const o of orders) {
    portals.set(o.channelSlug, o.portalName);
    if (o.agent) agents.add(agentLabel(o.agent));
  }
  return {
    portals: Array.from(portals, ([slug, name]) => ({ slug, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    agents: Array.from(agents).sort(),
  };
}
