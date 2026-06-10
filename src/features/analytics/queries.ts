// Query HogQL del modulo analytics. Due sole query per fill della cache:
// il rate limit della Query API (~120/h per key) impone di aggregare tutto
// in pass singoli con GROUP BY invece di una query per tenant.
// `days` arriva da un enum chiuso (RANGE_DAYS), mai da input utente raw.

const FUNNEL_EVENTS =
  "'product_added_to_cart', 'checkout_started', 'order_completed'";

// Query A — breakdown per (app, school_slug): copre totali, per-app e
// per-tenant in un passaggio. Colonne:
// [app, school_slug, pageviews, visitors, added_to_cart, checkouts, orders, revenue]
export function breakdownQuery(days: number): string {
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
WHERE timestamp >= now() - INTERVAL ${days} DAY
  AND event IN ('$pageview', ${FUNNEL_EVENTS})
  AND properties.app IN ('cms', 'storefront')
GROUP BY app, school_slug
`.trim();
}

// Query B — timeseries per (giorno, app). Colonne:
// [day, app, pageviews, visitors, orders, revenue]
export function timeseriesQuery(days: number): string {
  return `
SELECT
  toStartOfDay(timestamp) AS day,
  properties.app AS app,
  countIf(event = '$pageview') AS pageviews,
  uniqIf(distinct_id, event = '$pageview') AS visitors,
  countIf(event = 'order_completed') AS orders,
  sumIf(coalesce(toFloat(properties.total), 0), event = 'order_completed') AS revenue
FROM events
WHERE timestamp >= now() - INTERVAL ${days} DAY
  AND event IN ('$pageview', 'order_completed')
  AND properties.app IN ('cms', 'storefront')
GROUP BY day, app
ORDER BY day ASC
`.trim();
}
