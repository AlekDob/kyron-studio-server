// Il pannello Ordini mostra i filtri come una frase con chip: periodo, agente,
// portale, stato. Nico pero' compone tutto dentro `spec`, quindi la ricevuta
// diceva sempre "tutti i portali" anche quando la lista era di un portale solo.
//
// Qui la spec viene divisa: le condizioni che i chip sanno gia' rappresentare
// diventano filtri semplici, il resto resta spec. Non e' cosmetica — e' il modo
// in cui l'agente "accende" i controlli veri del pannello.
import type { QuerySpec } from "@/core/query/spec.js";

type Condition = QuerySpec["all"][number];

export interface FilterOptions {
  portals: Array<{ slug: string; name: string }>;
  agents: string[];
}

export interface SimpleFilters {
  portal: string;
  agent: string;
  status: string;
  spec: QuerySpec | null;
}

const STATUS_VALUES = ["confermati", "da-confermare", "annullati"];

const text = (value: Condition["value"]): string =>
  Array.isArray(value) ? "" : String(value ?? "").trim().toLowerCase();

/** Slug del portale se la condizione ne individua UNO solo, altrimenti null. */
function portalOf(c: Condition, portals: FilterOptions["portals"]): string | null {
  if (c.field !== "portale" && c.field !== "portaleNome") return null;
  if (c.op !== "eq" && c.op !== "contains") return null;
  const v = text(c.value);
  if (!v) return null;
  const hits = portals.filter(
    (p) => p.slug.toLowerCase().includes(v) || p.name.toLowerCase().includes(v),
  );
  return hits.length === 1 ? hits[0].slug : null;
}

function agentOf(c: Condition, agents: string[]): string | null {
  if (c.field !== "agente" && c.field !== "agenteEmail") return null;
  if (c.op !== "eq" && c.op !== "contains") return null;
  const v = text(c.value);
  if (!v) return null;
  const hits = agents.filter((a) => a.toLowerCase().includes(v));
  return hits.length === 1 ? hits[0] : null;
}

function statusOf(c: Condition): string | null {
  if (c.field !== "stato" || c.op !== "eq") return null;
  const v = text(c.value);
  return STATUS_VALUES.includes(v) ? v : null;
}

/**
 * Divide la spec in filtri semplici + resto. Due paletti perche' la lista
 * mostrata non cambi mai: si assorbe solo quando la condizione risolve a UN
 * valore certo, e mai da un `any` (li' le condizioni sono in OR, prenderne una
 * sola cambierebbe la domanda).
 */
export function splitSimpleFilters(
  spec: QuerySpec | null | undefined,
  options: FilterOptions,
): SimpleFilters {
  const empty: SimpleFilters = { portal: "all", agent: "all", status: "all", spec: null };
  if (!spec) return empty;
  if (spec.any.length > 0) return { ...empty, spec };

  const out = { ...empty };
  const rest: Condition[] = [];
  for (const c of spec.all) {
    const portal = out.portal === "all" ? portalOf(c, options.portals) : null;
    if (portal) {
      out.portal = portal;
      continue;
    }
    const agent = out.agent === "all" ? agentOf(c, options.agents) : null;
    if (agent) {
      out.agent = agent;
      continue;
    }
    const status = out.status === "all" ? statusOf(c) : null;
    if (status) {
      out.status = status;
      continue;
    }
    rest.push(c);
  }
  out.spec = rest.length > 0 ? { ...spec, all: rest } : null;
  return out;
}

/**
 * Valori cercati che non hanno dato righe ma che corrispondono a un agente o a
 * un portale del periodo. "Ordini di ravelli" filtrato su `cliente` torna zero:
 * ravelli non e' un cliente, e' l'agente a.ravelli. Meglio un suggerimento con
 * un dato vero che un "nessun ordine" muto — chi legge poi chiede conferma.
 */
export function fieldHints(
  spec: QuerySpec | null | undefined,
  options: FilterOptions,
): Array<{ campo: string; valore: string }> {
  if (!spec) return [];
  const hints: Array<{ campo: string; valore: string }> = [];
  for (const c of [...spec.all, ...spec.any]) {
    const v = text(c.value);
    // Solo termini testuali sensati: sotto le 3 lettere si becca di tutto.
    if (v.length < 3 || c.field === "agente" || c.field === "agenteEmail") continue;
    for (const a of options.agents) {
      if (a.toLowerCase().includes(v)) hints.push({ campo: "agente", valore: a });
    }
    if (c.field === "portale" || c.field === "portaleNome") continue;
    for (const p of options.portals) {
      if (p.name.toLowerCase().includes(v)) hints.push({ campo: "portaleNome", valore: p.name });
    }
  }
  return hints;
}
