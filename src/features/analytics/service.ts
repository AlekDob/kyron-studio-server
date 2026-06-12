import { listPortals } from "@/features/portals/reader.js";
import { makeTtlCache } from "./cache.js";
import { runHogql } from "./posthog.js";
import {
  RANGE_WINDOWS,
  breakdownQuery,
  geoQuery,
  leadsQuery,
  prevTotalsQuery,
  sourcesQuery,
  timeseriesQuery,
} from "./queries.js";
import {
  type AnalyticsOverview,
  type AppKey,
  type GeoCity,
  type KpiTotals,
  type LeadTotals,
  type PrevTotals,
  type SourceRow,
  type RangeKey,
  RANGE_DAYS,
  type TenantRow,
  type TimeseriesPoint,
  emptyLeads,
  emptyTotals,
} from "./types.js";

// Brain: decision-017 — il join dinamico PostHog <-> portali Payload vive qui.
// Nuovi shop compaiono da soli: o dal GROUP BY school_slug di PostHog
// (traffico senza portale onboardato, known:false) o da listPortals()
// (portale onboardato a traffico zero, riga zero-filled).

const TTL_MS = 5 * 60_000;
const cache = makeTtlCache<AnalyticsOverview>(TTL_MS);
const inflight = new Map<RangeKey, Promise<AnalyticsOverview>>();

export async function getOverview(range: RangeKey): Promise<AnalyticsOverview> {
  const hit = cache.get(range);
  if (hit) return hit;
  const pending = inflight.get(range);
  if (pending) return pending;

  const fill = fillOverview(range)
    .then((value) => {
      cache.set(range, value);
      return value;
    })
    .catch((err) => {
      // Stale-on-error: meglio dati vecchi (flaggati) che una pagina rotta.
      const stale = cache.getStale(range);
      if (stale) return { ...stale, stale: true };
      throw err;
    })
    .finally(() => inflight.delete(range));

  inflight.set(range, fill);
  return fill;
}

async function fillOverview(range: RangeKey): Promise<AnalyticsOverview> {
  const granularity = RANGE_WINDOWS[range].granularity;
  const [
    breakdownRows,
    seriesRows,
    leadsRows,
    prevRows,
    geoRows,
    sourcesRows,
    portalNames,
  ] = await Promise.all([
    runHogql(breakdownQuery(range)),
    runHogql(timeseriesQuery(range)),
    runHogql(leadsQuery(range)),
    runHogql(prevTotalsQuery(range)),
    runHogql(geoQuery(range)),
    runHogql(sourcesQuery(range)),
    loadPortalNames(),
  ]);

  const tenants = buildTenants(breakdownRows, portalNames);
  const byApp = sumByApp(tenants);
  const now = new Date();
  return {
    range,
    from: rangeFrom(range, now),
    to: isoDay(now),
    generatedAt: now.toISOString(),
    granularity,
    stale: false,
    totals: sumKpis([byApp.cms, byApp.storefront]),
    byApp,
    leads: buildLeads(leadsRows),
    prev: buildPrev(prevRows),
    geo: mapGeo(geoRows),
    sources: mapSources(sourcesRows),
    tenants,
    timeseries: mapTimeseries(seriesRows, granularity),
  };
}

// Row shape Query E: [city, country, lat, lon, visitors]
function mapGeo(rows: unknown[][]): GeoCity[] {
  return rows
    .filter((r) => num(r[4]) > 0)
    .map((r) => ({
      city: String(r[0] ?? "") || null,
      country: String(r[1] ?? ""),
      lat: num(r[2]),
      lon: num(r[3]),
      visitors: num(r[4]),
    }));
}

// Row shape Query F: [source, visitors]
function mapSources(rows: unknown[][]): SourceRow[] {
  return rows
    .filter((r) => num(r[1]) > 0)
    .map((r) => ({ source: String(r[0] ?? "$direct"), visitors: num(r[1]) }));
}

// from indicativo per lo zero-fill del chart: per i range di calendario
// usa il confine vero (giorno/lunedi'/primo del mese), per i rolling i giorni.
function rangeFrom(range: RangeKey, now: Date): string {
  if (range === "today") return isoDay(now);
  if (range === "yesterday")
    return isoDay(new Date(now.getTime() - 86_400_000));
  if (range === "week") {
    const d = new Date(now);
    // getUTCDay(): 0=domenica → lunedi' della settimana corrente.
    const shift = (d.getUTCDay() + 6) % 7;
    return isoDay(new Date(d.getTime() - shift * 86_400_000));
  }
  if (range === "month") return `${isoDay(now).slice(0, 8)}01`;
  return isoDay(new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000));
}

// Esportata per i test: aggrega le righe [event, form, count] della
// leadsQuery in totali + breakdown per form (ordinata per volume).
export function buildLeads(rows: unknown[][]): LeadTotals {
  const leads = emptyLeads();
  for (const r of rows) {
    const event = String(r[0] ?? "");
    const count = num(r[2]);
    if (event === "form_submitted") {
      leads.formSubmits += count;
      const form = String(r[1] ?? "") || "altro";
      leads.forms.push({ form, count });
    } else if (event === "newsletter_subscribed") {
      leads.newsletterSubs += count;
    } else if (event === "account_registered") {
      leads.registrations += count;
    }
  }
  leads.forms.sort((a, b) => b.count - a.count);
  return leads;
}

// I nomi dei portali sono cosmetici: se Payload e' giu' l'analytics
// funziona lo stesso (label = slug, known:false).
async function loadPortalNames(): Promise<Map<string, string>> {
  try {
    const portals = await listPortals();
    return new Map(portals.map((p) => [p.slug, p.nome]));
  } catch {
    return new Map();
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowKpis(row: unknown[]): KpiTotals {
  return {
    pageviews: num(row[2]),
    visitors: num(row[3]),
    addedToCart: num(row[4]),
    checkoutsStarted: num(row[5]),
    orders: num(row[6]),
    revenueEur: Math.round(num(row[7]) * 100) / 100,
  };
}

function sumKpis(items: KpiTotals[]): KpiTotals {
  return items.reduce((acc, k) => {
    acc.visitors += k.visitors;
    acc.pageviews += k.pageviews;
    acc.addedToCart += k.addedToCart;
    acc.checkoutsStarted += k.checkoutsStarted;
    acc.orders += k.orders;
    acc.revenueEur = Math.round((acc.revenueEur + k.revenueEur) * 100) / 100;
    return acc;
  }, emptyTotals());
}

function toTenantRow(
  key: string,
  app: AppKey,
  slug: string | null,
  label: string,
  known: boolean,
  kpis: KpiTotals,
): TenantRow {
  const conversionRate =
    kpis.visitors > 0
      ? Math.round((kpis.orders / kpis.visitors) * 10_000) / 10_000
      : 0;
  return { key, app, slug, label, known, conversionRate, ...kpis };
}

// Esportata per i test: e' il cuore del join dinamico.
export function buildTenants(
  rows: unknown[][],
  portalNames: Map<string, string>,
): TenantRow[] {
  // Il sito cms non ha school_slug: le sue righe collassano in una.
  const cmsKpis = sumKpis(
    rows.filter((r) => r[0] === "cms").map((r) => rowKpis(r)),
  );
  const shopRows = rows.filter(
    (r) => r[0] === "storefront" && String(r[1] ?? "") !== "",
  );

  const shops = shopRows.map((r) => {
    const slug = String(r[1]);
    if (slug === "demo") {
      return toTenantRow(slug, "storefront", slug, "Shop principale", true, rowKpis(r));
    }
    const nome = portalNames.get(slug);
    return toTenantRow(slug, "storefront", slug, nome ?? slug, Boolean(nome), rowKpis(r));
  });

  // Portali onboardati senza traffico nel periodo: riga a zero, cosi'
  // i nuovi shop compaiono subito nella breakdown.
  const seen = new Set(shops.map((s) => s.slug));
  for (const [slug, nome] of portalNames) {
    if (seen.has(slug)) continue;
    shops.push(toTenantRow(slug, "storefront", slug, nome, true, emptyTotals()));
  }

  return [
    toTenantRow("cms", "cms", null, "Sito kyronedu.it", true, cmsKpis),
    ...sortShops(shops),
  ];
}

// Shop principale sempre in testa, poi per ricavi e visitatori.
function sortShops(shops: TenantRow[]): TenantRow[] {
  return shops.sort((a, b) => {
    if (a.slug === "demo") return -1;
    if (b.slug === "demo") return 1;
    return b.revenueEur - a.revenueEur || b.visitors - a.visitors;
  });
}

function sumByApp(tenants: TenantRow[]): Record<AppKey, KpiTotals> {
  return {
    cms: sumKpis(tenants.filter((t) => t.app === "cms")),
    storefront: sumKpis(tenants.filter((t) => t.app === "storefront")),
  };
}

// Bucket "day" → "YYYY-MM-DD"; bucket "hour" → "YYYY-MM-DDTHH" (il client
// formatta l'etichetta oraria).
function mapTimeseries(
  rows: unknown[][],
  granularity: "hour" | "day",
): TimeseriesPoint[] {
  const len = granularity === "hour" ? 13 : 10;
  return rows
    .filter((r) => r[1] === "cms" || r[1] === "storefront")
    .map((r) => ({
      date: String(r[0]).slice(0, len),
      app: r[1] as AppKey,
      pageviews: num(r[2]),
      visitors: num(r[3]),
      orders: num(r[4]),
      revenueEur: Math.round(num(r[5]) * 100) / 100,
    }));
}

// Esportata per i test: parse delle righe Query D (periodo precedente).
// Row shape: [app, pageviews, visitors, carts, checkouts, orders, revenue,
//             form_submits, newsletter_subs, registrations]
export function buildPrev(rows: unknown[][]): PrevTotals {
  const byApp: Record<AppKey, KpiTotals> = {
    cms: emptyTotals(),
    storefront: emptyTotals(),
  };
  const leads = { formSubmits: 0, newsletterSubs: 0, registrations: 0 };
  for (const r of rows) {
    const app = r[0];
    if (app !== "cms" && app !== "storefront") continue;
    byApp[app] = {
      pageviews: num(r[1]),
      visitors: num(r[2]),
      addedToCart: num(r[3]),
      checkoutsStarted: num(r[4]),
      orders: num(r[5]),
      revenueEur: Math.round(num(r[6]) * 100) / 100,
    };
    leads.formSubmits += num(r[7]);
    leads.newsletterSubs += num(r[8]);
    leads.registrations += num(r[9]);
  }
  return { totals: sumKpis([byApp.cms, byApp.storefront]), byApp, leads };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
