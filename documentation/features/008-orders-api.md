---
type: feature
project: studio-server
created: 2026-06-14
status: shipped
tags: [orders, saleor, gateway, portals, commerciali]
---

# Feature 008 — API ordini per il modulo Ordini di Studio

> **Update 2026-08-28 — motore di query generico, filtri lato server**: `GET
> /api/v1/orders` accetta ora `status`, `q` e `spec` (una query JSON validata zod)
> oltre a `portal`/`agent`. Nuovo `src/core/query/spec.ts`: condizioni `{field, op,
> value}` combinate in `all` (AND) / `any` (OR) + `sort` opzionale, valutate su una
> `FieldMap` per dominio — zero dipendenze dal dominio ordini, pensato per essere
> riusato da Prodotti quando servirà. `src/features/orders/query-fields.ts` è la
> `FieldMap` degli ordini (24 campi: `totale`, `data`, `prodotti` = SKU+nomi riga
> concatenati, `metodoPagamento`, ecc.) e **la sola** `statusBucketOf` del progetto
> (prima ne esistevano tre copie divergenti: route, tool di Nico, pannello Studio —
> quando divergevano il conteggio in chat non tornava coi KPI in pagina).
> La risposta ora porta anche `buckets` (conteggio+euro per stato, calcolati su
> tutto tranne lo stato — sono i bottoni di navigazione) e `portals`/`agents`
> (opzioni dei select, dall'intero periodo, non dal set filtrato).
> `list_orders` (agente Nico) prende `{from, to, spec}`: compone lui la query
> strutturata invece dei quattro filtri fissi di prima. Esempi nella description
> del tool: "sopra 600 euro non confermati di r.russo", "con un iPad pagati con
> Carta del Docente". Cache di processo 60s su `fetchOrdersForRange` (TTL,
> invalidata da `setOrderMeta`/`markOrderAsPaid`): senza, ogni cambio filtro
> riscaricava l'intero range da Saleor. Test: `tests/core/query-spec.test.ts`
> (AND/OR, confronto numerico, `contains` case-insensitive, campo sconosciuto →
> throw, `sort`). Lato frontend: studio feature 010.

> **Update 2026-07-21 (validato in prod + 2 fix)**: validato su un ordine DRAFT
> throwaway in produzione, attraverso l'endpoint reale (mint cookie `kyron-rev` +
> chiamata HTTP da dentro il container). Due bug trovati e corretti prima del
> go-live: **(1)** la mutation Saleor 3.23 per aggiungere righe è
> **`orderLinesCreate`**, non `orderLinesAdd` (che non esiste → 400). **(2)**
> `changeLineVariant` faceva delete-poi-add: se l'add falliva la riga era persa e
> l'ordine restava a 0 righe. Ora è **add-prima-di-delete** (se l'add fallisce la
> riga originale resta intatta). Con il fix: cambio colore mantiene il totale
> esatto riusando lo sconto MANUALE esistente (non lo duplica); cambio quantità lo
> ricalcola correttamente. Manca ancora uno smoke test su un ordine reale con
> **voucher bundle** (kit) per il caso voucher-collapse. Dettagli:
> `documentation/gotchas/gotcha-saleor-order-line-edit-unconfirmed-only.md`.

> **Update 2026-07-21**: endpoint di scrittura aggiunti per le estensioni del modulo
> Ordini (studio feature 010).
> - `POST /api/v1/orders/teacher-card-residual-paid` — **pagamento misto tranche 2**:
>   incasso del residuo bonifico dopo il buono Carta del Docente → `orderMarkAsPaid`
>   + metadata `teacherCardResidualPaidAt` + mail. `markResidualBankTransferPaid` in
>   `features/orders/bank-transfer.ts`. `markTeacherCardAcquired` ora salda l'ordine
>   solo se il buono copre tutto **o** il residuo è su carta (già su Stripe); residuo
>   bonifico → resta "acconto". `OrderSummary`/`fetchOrderCoverage` leggono
>   `teacherCardResidualMethod`/`teacherCardResidualAmount`. **Fix successivo**: il
>   pulsante di saldo lato Studio non deve dipendere da `residualMethod` (spesso
>   assente sugli ordini misti reali) — vedi studio feature 010.
> - `PATCH /api/v1/orders/note` — nota operatore (`kyron_note`) via `setOrderMeta`;
>   letta anche dall'export Danea (FootNotes).
> - `PATCH /api/v1/orders/vat-override` — override IVA ordine (`kyron_vat_override`),
>   letto da `resolveVat` ecommerce (l'IVA non è modellata su Saleor).
> - `GET /api/v1/orders/edit?id=` + `POST /api/v1/orders/line` — **editing reale righe**
>   (qty / cambio colore-variante) SOLO su ordini `UNCONFIRMED` (money-path). Nuovo
>   `src/core/saleor/order-edit.ts`: `orderLineUpdate` / `orderLinesCreate`+`orderLineDelete`
>   + navigazione varianti sorelle + **re-adjust totale** (riusa lo sconto MANUALE
>   esistente, misura-e-correggi, come `forceOrderTotalViaDiscount`; MAI rimuovere il
>   voucher bundle). Validato su draft prod (vedi update sopra).

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
| Esclusioni | ordini di test interni (`ORDERS_REPORT_EXCLUDE_EMAILS`, default `alek…gmail`) |
| Risposta | `{ from, to, count, totalGross, orders: EnrichedOrder[] }` |
| Cambio stato | `PATCH /api/v1/orders/status` body `{ id, status }` — stato lavorazione |

## Stato lavorazione + notifica spedizione

`PATCH /api/v1/orders/status` (tutti gli utenti) scrive `kyron_status` in
`order.metadata` Saleor (NON usa la fulfillment nativa → niente email Saleor).
Stati: `nuovo|in_preparazione|spedito|consegnato|annullato` (`src/features/orders/status.ts`).
Su transizione a **`spedito`** invia una mail "ordine spedito" al cliente, **gata da
`ORDERS_SHIP_NOTIFY_ALLOW`** (CSV): se valorizzata invia solo a quegli indirizzi
(modalità test), se vuota invia a tutti (go-live).
`OrderSummary` espone `id` (per la mutation) e `workflowStatus`.

**Update 2026-07-22 — go-live**: `ORDERS_SHIP_NOTIFY_ALLOW` svuotata su Coolify prod
(era `gmail@alekdob.com`) + redeploy, su richiesta esplicita di Alek (>200 ordini reali
già in produzione). La mail "spedito" ora va a **tutti** i clienti reali sulle nuove
transizioni a "Spedito" — **non retroattiva**, non rimanda nulla per gli ordini già
spediti prima del cambio. Le mail di conferma pagamento (bonifico/carta docente,
`bank-transfer.ts`/`teacher-card.ts`) non sono mai state gate: vanno al cliente da sempre.

## File

| File | Ruolo |
|---|---|
| `src/core/saleor/orders.ts` | `fetchOrdersForRange(from,to)` + `fetchOrdersForDay` (helper `fetchOrders` condiviso). Aggiunti `status`/`paymentStatus` a `OrderSummary` |
| `src/features/orders/enrich.ts` | `buildPortalIndex()` (1 sola `listPortals()`) + `enrichOrder()` → `EnrichedOrder` (agent, codiceMeccanografico, portalName, portalUrl, **stripeUrl**) |

`OrderSummary` include anche dati **cliente** (`customerName`/`customerPhone`/`customerAddress`
da billingAddress, fallback user/email) e **`pspReference`** (Stripe PaymentIntent `pi_...`
dalla prima `transactions[]`). `stripeUrl` = `https://dashboard.stripe.com/payments/{pspReference}`.
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
- **Stripe `pi_` non `pm_` + dati fiscali in `billingAddress.metadata`**: vedi
  `documentation/gotchas/gotcha-saleor-order-stripe-pi-and-fiscal-metadata.md`.
- **Email "spedito"** rifatta col design system Kyron (skill `kyron-email`): card 600px
  table-based, logo `cid:kyron-logo`. `renderShipEmail()` in `features/orders/status.ts`.
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
