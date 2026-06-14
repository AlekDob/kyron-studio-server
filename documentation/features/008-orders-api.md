---
type: feature
project: studio-server
created: 2026-06-14
status: shipped
tags: [orders, saleor, gateway, portals, commerciali]
---

# Feature 008 — API ordini per il modulo Ordini di Studio

Endpoint READ `GET /api/v1/orders` che lista gli ordini Saleor in un intervallo di
date, **arricchiti** con i metadati portale (agente commerciale, codice meccanografico,
link al portale). Backend del modulo Ordini frontend (studio feature 010). Riusa la
lettura ordini di feature 007 (report email).

## Cosa fa

| | |
|---|---|
| Rotta | `GET /api/v1/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&portal=slug&agent=email` |
| Auth | `tenantMiddleware` + `studioAuthMiddleware` — **tutti** gli utenti Studio (NO requireAdmin) |
| Default periodo | `from` = oggi-30g, `to` = oggi (UTC) |
| Filtri opz. | `portal` (channelSlug), `agent` (email o local-part) |
| Risposta | `{ from, to, count, totalGross, orders: EnrichedOrder[] }` |

## File

| File | Ruolo |
|---|---|
| `src/core/saleor/orders.ts` | `fetchOrdersForRange(from,to)` + `fetchOrdersForDay` (helper `fetchOrders` condiviso). Aggiunti `status`/`paymentStatus` a `OrderSummary` |
| `src/features/orders/enrich.ts` | `buildPortalIndex()` (1 sola `listPortals()`) + `enrichOrder()` → `EnrichedOrder` (agent, codiceMeccanografico, portalName, portalUrl) |
| `src/features/orders/route.ts` | Hono route, parse Zod query, fetch+enrich+filtra |
| `src/features/portals/reader.ts` | `PortalSummary.codiceMeccanografico` esposto (era solo in `PortalDetail`) |

## Join ordine → portale

`order.channelSlug === portal.slug`. Per le scuole onboardate slug == channel Saleor.
Il main shop (es. `scuola-demo`) non ha doc portale → `agent`/`codiceMeccanografico`
vuoti, `portalUrl` punta comunque a `KYRON_SHOP_BASE_URL/{channelSlug}`.

## Env

Nessuna env nuova obbligatoria: riusa `SALEOR_API_URL` + `SALEOR_APP_TOKEN`
(MANAGE_ORDERS, già in prod per feature 007). Opzionale `KYRON_SHOP_BASE_URL`
(default `https://kyronedu.it/shop`) per il link al portale.

## Decisioni / gotcha

- **App token, non admin staff**: come feature 007, un admin con `restrictedAccessToChannels`
  vedrebbe 0 ordini. Si usa l'App token globale.
- **Filtro portale/agente lato server è opzionale**: il frontend (feature 010) fa un solo
  fetch per periodo e filtra portale/agente **client-side** (UX istantanea); i query param
  restano per usi API diretti.
- **Range 30g** = paginazione multipla Saleor; volumi attuali bassi → ok. Se cresce, valutare
  cache TTL come analytics (`getOverview`).

## Verifica

```
curl -s 'http://localhost:8790/api/v1/orders?from=2026-05-15&to=2026-06-14' \
  -H 'X-Tenant: kyron' -H 'Cookie: kyron-rev=<dev-cookie>' | jq '.count, .orders[0]'
```
Richiede `SALEOR_APP_TOKEN` (solo prod) + Payload raggiungibile per l'enrich.
