// Query HogQL del modulo analytics. Poche query aggregate per fill della
// cache: il rate limit della Query API (~120/h per key) impone di aggregare
// in pass singoli con GROUP BY invece di una query per tenant.
// `range` arriva da un enum chiuso (RangeKey), mai da input utente raw.

import type { RangeKey } from "./types.js";

const FUNNEL_EVENTS =
  "'product_added_to_cart', 'checkout_started', 'order_completed'";

const LEAD_EVENTS =
  "'form_submitted', 'newsletter_subscribed', 'account_registered'";

// Solo traffico di PRODUZIONE: PostHog cattura $host su ogni evento, e il
// project e' condiviso con staging/smoke test (storico incluso) — senza
// questo filtro i numeri di Studio conterebbero anche staging.kyronedu.it
// e localhost.
const PROD_HOSTS = "'kyronedu.it', 'www.kyronedu.it'";

// Finestre temporali espresse in HogQL: i confini giorno/settimana/mese
// vengono calcolati da ClickHouse nella timezone del project PostHog
// (impostarla su Europe/Rome nelle settings del project).
interface RangeWindow {
  fromExpr: string;
  toExpr: string;
  granularity: "hour" | "day";
}

export const RANGE_WINDOWS: Record<RangeKey, RangeWindow> = {
  today: {
    fromExpr: "toStartOfDay(now())",
    toExpr: "now()",
    granularity: "hour",
  },
  yesterday: {
    fromExpr: "toStartOfDay(now()) - INTERVAL 1 DAY",
    toExpr: "toStartOfDay(now())",
    granularity: "hour",
  },
  week: { fromExpr: "toMonday(now())", toExpr: "now()", granularity: "day" },
  month: {
    fromExpr: "toStartOfMonth(now())",
    toExpr: "now()",
    granularity: "day",
  },
  "7d": {
    fromExpr: "now() - INTERVAL 7 DAY",
    toExpr: "now()",
    granularity: "day",
  },
  "30d": {
    fromExpr: "now() - INTERVAL 30 DAY",
    toExpr: "now()",
    granularity: "day",
  },
  "90d": {
    fromExpr: "now() - INTERVAL 90 DAY",
    toExpr: "now()",
    granularity: "day",
  },
};

// Periodo corrente: [from, to). Periodo precedente: stessa durata trascorsa,
// subito prima di from (es. "questo mese" parziale vs stessa porzione del
// mese scorso) — formula verificata live sulla Query API.
function currentWhere(w: RangeWindow): string {
  return `timestamp >= ${w.fromExpr} AND timestamp < ${w.toExpr}`;
}

function previousWhere(w: RangeWindow): string {
  const prevFrom = `addSeconds(${w.fromExpr}, -dateDiff('second', ${w.fromExpr}, ${w.toExpr}))`;
  return `timestamp >= ${prevFrom} AND timestamp < ${w.fromExpr}`;
}

// Query A — breakdown per (app, school_slug): copre totali, per-app e
// per-tenant in un passaggio. Colonne:
// [app, school_slug, pageviews, visitors, added_to_cart, checkouts, orders, revenue]
export function breakdownQuery(range: RangeKey): string {
  const w = RANGE_WINDOWS[range];
  return `
SELECT
  properties.app AS app,
  coalesce(properties.school_slug, '') AS school_slug,
  countIf(event = '$pageview') AS pageviews,
  uniqIf(distinct_id, event = '$pageview') AS visitors,
  countIf(event = 'product_added_to_cart') AS added_to_cart,
  countIf(event = 'checkout_started') AS checkouts_started,
  countIf(event = 'order_completed') AS orders,
  sumIf(coalesce(toFloat(properties.total), 0), event = 'order_completed') AS revenue
FROM events
WHERE ${currentWhere(w)}
  AND event IN ('$pageview', ${FUNNEL_EVENTS})
  AND properties.app IN ('cms', 'storefront')
  AND properties.$host IN (${PROD_HOSTS})
GROUP BY app, school_slug
`.trim();
}

// Query C — lead events: form compilati (con quale form), iscrizioni
// newsletter Brevo, registrazioni account shop. Colonne:
// [event, form, count]
export function leadsQuery(range: RangeKey): string {
  const w = RANGE_WINDOWS[range];
  return `
SELECT
  event,
  coalesce(properties.form, '') AS form,
  count() AS cnt
FROM events
WHERE ${currentWhere(w)}
  AND event IN (${LEAD_EVENTS})
  AND properties.app IN ('cms', 'storefront')
  AND properties.$host IN (${PROD_HOSTS})
GROUP BY event, form
`.trim();
}

// Query B — timeseries per (bucket, app). Bucket = giorno, oppure ora per
// i range Oggi/Ieri (un solo giorno: la serie giornaliera sarebbe 1 punto).
// Colonne: [bucket, app, pageviews, visitors, orders, revenue]
export function timeseriesQuery(range: RangeKey): string {
  const w = RANGE_WINDOWS[range];
  const bucket =
    w.granularity === "hour"
      ? "toStartOfHour(timestamp)"
      : "toStartOfDay(timestamp)";
  return `
SELECT
  ${bucket} AS bucket,
  properties.app AS app,
  countIf(event = '$pageview') AS pageviews,
  uniqIf(distinct_id, event = '$pageview') AS visitors,
  countIf(event = 'order_completed') AS orders,
  sumIf(coalesce(toFloat(properties.total), 0), event = 'order_completed') AS revenue
FROM events
WHERE ${currentWhere(w)}
  AND event IN ('$pageview', 'order_completed')
  AND properties.app IN ('cms', 'storefront')
  AND properties.$host IN (${PROD_HOSTS})
GROUP BY bucket, app
ORDER BY bucket ASC
`.trim();
}

// Query D — totali del PERIODO PRECEDENTE per il confronto, grouped by app
// (bastano i totali: il confronto vive sulle card KPI, non per-tenant).
// Colonne: [app, pageviews, visitors, added_to_cart, checkouts, orders,
//           revenue, form_submits, newsletter_subs, registrations]
export function prevTotalsQuery(range: RangeKey): string {
  const w = RANGE_WINDOWS[range];
  return `
SELECT
  properties.app AS app,
  countIf(event = '$pageview') AS pageviews,
  uniqIf(distinct_id, event = '$pageview') AS visitors,
  countIf(event = 'product_added_to_cart') AS added_to_cart,
  countIf(event = 'checkout_started') AS checkouts_started,
  countIf(event = 'order_completed') AS orders,
  sumIf(coalesce(toFloat(properties.total), 0), event = 'order_completed') AS revenue,
  countIf(event = 'form_submitted') AS form_submits,
  countIf(event = 'newsletter_subscribed') AS newsletter_subs,
  countIf(event = 'account_registered') AS registrations
FROM events
WHERE ${previousWhere(w)}
  AND event IN ('$pageview', ${FUNNEL_EVENTS}, ${LEAD_EVENTS})
  AND properties.app IN ('cms', 'storefront')
  AND properties.$host IN (${PROD_HOSTS})
GROUP BY app
`.trim();
}
