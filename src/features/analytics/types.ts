// Brain: decision-017 — analytics di gruppo su PostHog Cloud EU.
// Shape del payload servito a Studio: KPI totali + per-app + breakdown
// per tenant (sito / shop principale / portali scuola) + timeseries.

// Periodi standard (oggi/ieri/settimana/mese, confini di calendario) +
// finestre rolling 7/30/90 giorni. Le finestre HogQL vivono in queries.ts.
export type RangeKey =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "7d"
  | "30d"
  | "90d";

export const RANGE_KEYS: RangeKey[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "7d",
  "30d",
  "90d",
];

// Giorni APPROSSIMATIVI per range: servono solo per calcolare from/to
// indicativi nel payload (zero-fill del chart lato client).
export const RANGE_DAYS: Record<RangeKey, number> = {
  today: 1,
  yesterday: 1,
  week: 7,
  month: 31,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export type AppKey = "cms" | "storefront";

export interface KpiTotals {
  visitors: number;
  pageviews: number;
  addedToCart: number;
  checkoutsStarted: number;
  orders: number;
  revenueEur: number;
}

export interface TenantRow extends KpiTotals {
  // "cms" per il sito, altrimenti lo school_slug dello shop.
  key: string;
  app: AppKey;
  slug: string | null;
  label: string;
  // false = slug presente in PostHog ma portale non (ancora) onboardato.
  known: boolean;
  // orders / visitors, 0 se visitors = 0.
  conversionRate: number;
}

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  app: AppKey;
  visitors: number;
  pageviews: number;
  orders: number;
  revenueEur: number;
}

// Lead KPI globali (non per-tenant): form compilati con breakdown per
// form, iscrizioni newsletter Brevo, registrazioni account shop.
export interface LeadTotals {
  formSubmits: number;
  newsletterSubs: number;
  registrations: number;
  forms: Array<{ form: string; count: number }>;
}

export function emptyLeads(): LeadTotals {
  return { formSubmits: 0, newsletterSubs: 0, registrations: 0, forms: [] };
}

// Totali del periodo precedente (stessa durata trascorsa, subito prima):
// alimentano i delta sulle card KPI. Solo totali per-app, niente tenant.
export interface PrevTotals {
  totals: KpiTotals;
  byApp: Record<AppKey, KpiTotals>;
  leads: { formSubmits: number; newsletterSubs: number; registrations: number };
}

// Citta' dei visitatori (GeoIP PostHog). city null = non rilevata.
export interface GeoCity {
  city: string | null;
  country: string;
  lat: number;
  lon: number;
  visitors: number;
}

// Fonte di traffico: utm_source o referring domain; "$direct" = diretto.
export interface SourceRow {
  source: string;
  visitors: number;
}

export interface AnalyticsOverview {
  range: RangeKey;
  from: string;
  to: string;
  generatedAt: string;
  // "hour" per Oggi/Ieri (timeseries oraria), altrimenti "day".
  granularity: "hour" | "day";
  // true se servito dal fallback stale-on-error (PostHog irraggiungibile).
  stale: boolean;
  totals: KpiTotals;
  byApp: Record<AppKey, KpiTotals>;
  leads: LeadTotals;
  prev: PrevTotals;
  geo: GeoCity[];
  sources: SourceRow[];
  tenants: TenantRow[];
  timeseries: TimeseriesPoint[];
}

export function emptyTotals(): KpiTotals {
  return {
    visitors: 0,
    pageviews: 0,
    addedToCart: 0,
    checkoutsStarted: 0,
    orders: 0,
    revenueEur: 0,
  };
}
