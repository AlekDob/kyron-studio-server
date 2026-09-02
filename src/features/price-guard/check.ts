// Price Guard — runner del check prezzi/sconti dei portali. SOLO LETTURA:
// interroga Saleor prod, non modifica nulla. Ogni tipo di anomalia e' una
// "regola" indipendente (vedi rules.ts); aggiungerne una = una funzione + una
// riga nel registro. Brain: kit-voucher-double-discount, normalize-discount-capacity-blind-bug.
import {
  getPortal,
  listPortals,
  type PortalDetail,
} from "@/features/portals/reader.js";
import {
  toEnableConfig,
  type BundleConfig,
  type EnablePortalConfig,
} from "@/features/portals/enable/config.js";
import type { SaleorTarget } from "@/features/portals/enable/saleor-admin.js";
import { romeYesterday } from "@/core/scheduler.js";
import type { ProductRef } from "./reads.js";
import { RULES, type Rule } from "./rules.js";
import { fetchStaticBundles } from "./static-bundles.js";

// Il check gira SOLO su prod: i prezzi staging derivano (portal-enable-staging-price-drift).
export const CHECK_TARGET: SaleorTarget = "prod";
// Tolleranza sui confronti in euro (arrotondamenti Saleor).
export const EUR_TOL = 0.01;

export type Severity = "high" | "medium" | "low";

export interface Anomaly {
  type: string;
  severity: Severity;
  portal: string;
  portalName: string;
  kit?: string;
  expected?: number; // reale al checkout
  shown?: number; // prezzo mostrato (finalPriceEur)
  delta?: number;
  detail: string;
  // Ordini colpiti IERI (numero + data), quando l'anomalia e' collegabile a un
  // voucher kit. Vuoto = configurazione sbagliata ma nessun ordine ieri.
  orders?: Array<{ number: string; created: string; totalGross: number }>;
}

// Contesto per portale caricato una volta e passato a ogni regola.
export interface PortalContext {
  target: SaleorTarget;
  channel: string; // = slug per le scuole onboarded
  portal: PortalDetail;
  config: EnablePortalConfig;
  cache: Map<string, ProductRef>;
  // Data (YYYY-MM-DD) da cui cercare gli ordini colpiti: IERI, come i report
  // ordini/analytics giornalieri. La mail e' un digest del giorno prima.
  ordersFrom: string;
}

function buildContext(
  portal: PortalDetail,
  ordersFrom: string,
  staticBundles?: BundleConfig[],
): PortalContext {
  const config = toEnableConfig(portal);
  // Tenant con kit statici: sono quelli serviti dallo storefront, i kit Payload
  // dello stesso tenant sono cloni morti. Vedi static-bundles.ts.
  if (staticBundles?.length) config.bundles = staticBundles;
  return {
    target: CHECK_TARGET,
    channel: portal.slug,
    portal,
    config,
    cache: new Map(),
    ordersFrom,
  };
}

// Regole abilitate: default tutte, override via env PRICE_GUARD_RULES (CSV di id)
// o via l'argomento opzionale (usato dall'agente per un check mirato).
function enabledRules(ids?: string[]): Rule[] {
  const wanted =
    ids ??
    (process.env.PRICE_GUARD_RULES
      ? process.env.PRICE_GUARD_RULES.split(",").map((s) => s.trim()).filter(Boolean)
      : null);
  if (!wanted) return RULES;
  return RULES.filter((r) => wanted.includes(r.id));
}

// Channel che NON sono portali scuola: hanno un doc Payload "onboarded" ma sono
// canali del main shop (es. carta-docente), dove l'intero catalogo e' in vendita.
// Controllarli genera falsi positivi (tagli "stale" che sono legittimi).
function excludedSlugs(): Set<string> {
  const raw = process.env.PRICE_GUARD_EXCLUDE_PORTALS ?? "carta-docente,scuola-demo";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Solo le scuole onboarded hanno un channel Saleor con prezzi/voucher da controllare.
async function portalsToCheck(slug?: string): Promise<PortalDetail[]> {
  if (slug) {
    const p = await getPortal(slug);
    return p ? [p] : [];
  }
  const skip = excludedSlugs();
  const summaries = await listPortals();
  const onboarded = summaries.filter(
    (s) => s.status === "onboarded" && !skip.has(s.slug),
  );
  const details = await Promise.all(onboarded.map((s) => getPortal(s.slug)));
  return details.filter((p): p is PortalDetail => Boolean(p));
}

export interface RunOptions {
  portalSlug?: string;
  rules?: string[];
  // Data YYYY-MM-DD da cui cercare gli ordini colpiti. Default: ieri (digest
  // giornaliero). Il CHECK guarda sempre la configurazione ATTUALE — e' solo la
  // lista ordini a essere limitata al giorno.
  ordersFrom?: string;
}

// Esegue il check e ritorna tutte le anomalie (vuoto = tutto ok).
export async function runPriceGuard(opts: RunOptions = {}): Promise<Anomaly[]> {
  const portals = await portalsToCheck(opts.portalSlug);
  const rules = enabledRules(opts.rules);
  const ordersFrom = opts.ordersFrom ?? romeYesterday().date;
  const staticBundles = await fetchStaticBundles();
  const out: Anomaly[] = [];
  for (const portal of portals) {
    const ctx = buildContext(portal, ordersFrom, staticBundles.get(portal.slug));
    for (const rule of rules) {
      try {
        out.push(...(await rule.run(ctx)));
      } catch (err) {
        out.push({
          type: "rule-error",
          severity: "low",
          portal: portal.slug,
          portalName: portal.nome,
          detail: `Regola ${rule.id} fallita: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }
  return out;
}
