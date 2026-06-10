// Brain: decision-017 — analytics di gruppo su PostHog Cloud EU.
// Shape del payload servito a Studio: KPI totali + per-app + breakdown
// per tenant (sito / shop principale / portali scuola) + timeseries.

export type RangeKey = "7d" | "30d" | "90d";
export type AppKey = "cms" | "storefront";

export const RANGE_DAYS: Record<RangeKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

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

export interface AnalyticsOverview {
  range: RangeKey;
  from: string;
  to: string;
  generatedAt: string;
  // true se servito dal fallback stale-on-error (PostHog irraggiungibile).
  stale: boolean;
  totals: KpiTotals;
  byApp: Record<AppKey, KpiTotals>;
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
