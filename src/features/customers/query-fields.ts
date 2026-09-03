// Mappa campi dei clienti per il motore di query generico (core/query/spec.ts).
// Stesso motore degli ordini, seconda FieldMap: i filtri del pannello, quelli
// dell'API e quelli che scrive Bea in chat restano un percorso solo.
import type { FieldMap, QuerySpec } from "@/core/query/spec.js";
import { applySpec } from "@/core/query/spec.js";
import { agentLabel } from "@/features/orders/query-fields.js";
import type { CustomerRow } from "./derive.js";

export const CUSTOMER_GROUPS = ["nuovi", "ricorrenti"] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];

// Un cliente puo' essere nuovo E ricorrente (due ordini in un mese): non sono
// stati esclusivi come quelli degli ordini, sono due bandiere.
export const CUSTOMER_FIELDS: FieldMap<CustomerRow> = {
  cliente: (c) => c.name,
  email: (c) => c.email,
  telefono: (c) => c.phone,
  citta: (c) => c.address,
  azienda: (c) => c.companyName,
  codiceFiscale: (c) => c.fiscalCode,
  partitaIva: (c) => c.vatNumber,
  studente: (c) => c.studentName,
  portale: (c) => c.portals.map((p) => p.slug).join(" | "),
  portaleNome: (c) => c.portals.map((p) => p.name).join(" | "),
  agente: (c) => c.agents.map(agentLabel).join(" | "),
  agenteEmail: (c) => c.agents.join(" | "),
  ordini: (c) => c.orders,
  annullati: (c) => c.canceled,
  speso: (c) => c.totalSpent,
  primoOrdine: (c) => c.firstOrder.slice(0, 10),
  ultimoOrdine: (c) => c.lastOrder.slice(0, 10),
  numeri: (c) => c.orderNumbers.join(" | "),
  prodotti: (c) => c.products,
  nuovo: (c) => c.isNew,
  ricorrente: (c) => c.isReturning,
};

export const CUSTOMER_FIELD_NAMES = Object.keys(CUSTOMER_FIELDS);

// Campi su cui pesca la barra di ricerca del pannello.
const SEARCH_FIELDS = ["cliente", "email", "telefono", "azienda", "numeri"] as const;

export interface FlatFilter {
  portal?: string;
  agent?: string;
  group?: string;
  q?: string;
}

/** I filtri semplici del pannello diventano condizioni dello stesso motore. */
export function flatToSpec(flat: FlatFilter, base?: QuerySpec): QuerySpec {
  const all = [...(base?.all ?? [])];
  const any = [...(base?.any ?? [])];
  // `contains` e non `eq`: un cliente puo' aver comprato su piu' portali, il
  // campo e' una lista appiattita.
  if (flat.portal && flat.portal !== "all") {
    all.push({ field: "portale", op: "contains", value: flat.portal });
  }
  if (flat.agent && flat.agent !== "all") {
    all.push({ field: "agente", op: "contains", value: agentLabel(flat.agent) });
  }
  if (flat.group === "nuovi") all.push({ field: "nuovo", op: "eq", value: true });
  if (flat.group === "ricorrenti") all.push({ field: "ricorrente", op: "eq", value: true });
  const needle = flat.q?.trim();
  if (needle) {
    for (const f of SEARCH_FIELDS) any.push({ field: f, op: "contains", value: needle });
  }
  return { all, any, sort: base?.sort };
}

export interface Bucket {
  count: number;
  eur: number;
}
export type Buckets = Record<"all" | CustomerGroup, Bucket>;

/** KPI di testata, calcolati sul set filtrato da tutto TRANNE il gruppo. */
export function bucketTotals(customers: CustomerRow[]): Buckets {
  const empty = (): Bucket => ({ count: 0, eur: 0 });
  const out: Buckets = { all: empty(), nuovi: empty(), ricorrenti: empty() };
  for (const c of customers) {
    out.all.count++;
    out.all.eur += c.totalSpent;
    if (c.isNew) {
      out.nuovi.count++;
      out.nuovi.eur += c.totalSpent;
    }
    if (c.isReturning) {
      out.ricorrenti.count++;
      out.ricorrenti.eur += c.totalSpent;
    }
  }
  return out;
}

/** Filtro completo: spec dell'agente + filtri piatti del pannello. */
export function filterCustomers(
  customers: CustomerRow[],
  flat: FlatFilter,
  spec?: QuerySpec,
): CustomerRow[] {
  return applySpec(customers, flatToSpec(flat, spec), CUSTOMER_FIELDS);
}

/** Opzioni dei select: da TUTTI i clienti del periodo, non dal set filtrato. */
export function filterOptions(customers: CustomerRow[]): {
  portals: Array<{ slug: string; name: string }>;
  agents: string[];
} {
  const portals = new Map<string, string>();
  const agents = new Set<string>();
  for (const c of customers) {
    for (const p of c.portals) portals.set(p.slug, p.name);
    for (const a of c.agents) agents.add(agentLabel(a));
  }
  return {
    portals: Array.from(portals, ([slug, name]) => ({ slug, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    agents: Array.from(agents).sort(),
  };
}
