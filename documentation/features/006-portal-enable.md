---
type: feature
project: studio-server
created: 2026-06-12
last_verified: 2026-07-10
tags: [portals, saleor, onboarding, pipeline, unpaid-orders, offline-payments, money-path, kyron-ops]
status: implemented-local
---

# 006 — Portal Enable (seed Saleor server-side)

Fase B di decision-018 (umbrella). Sostituisce il giro "mail con prompt ->
Claude Code locale -> seed CLI" con un click in Studio.

## Endpoint

| Route | Auth | Body | Note |
|---|---|---|---|
| `POST /api/v1/portals/:slug/enable` | X-Tenant + kyron-rev | `{targets?: ["staging","prod"]}` | default entrambi; idempotente; ~30-90s |

## Moduli

| File | Ruolo |
|---|---|
| `src/features/portals/enable/saleor-admin.ts` | client GraphQL admin (tokenCreate, cache token per target, retry su jwt scaduto) |
| `src/features/portals/enable/config.ts` | PortalDetail (jsonb Payload) -> EnablePortalConfig; selection variant/fixed/by-attribute |
| `src/features/portals/enable/seed-steps.ts` | port 1:1 step CLI: ensureChannel (channelCreate con `orderSettings.allowUnpaidOrders:true` + `automaticallyConfirmAllNewOrders:true` — vedi money-path sotto), ensureShipping, setVisibility (hidden-but-purchasable), setVariantPrice, upsertPromotion (FIXED su listino pieno / PERCENTAGE), ensureVoucher (ENTIRE_ORDER FIXED, applyOncePerOrder:false), resolveBundleSaving, voucherCodeFor |
| `src/features/portals/enable/enable.ts` | orchestratore per target + buildPubPlans + poll onSale 75s + guard channelId divergenti + markOnboarded su Payload + call kyron-ops (recalc se sconti, Stripe config al primo go-live) |
| `src/features/portals/enable/ops-client.ts` | client kyron-ops (decision-020): `opsRecalc` materializza le Promotion, `opsAssignStripe` assegna la config Stripe live al channel; best-effort no-op senza `KYRON_OPS_URL/TOKEN` |
| `src/features/portals/enable/notify.ts` | mail "portale live" (template kyron-email, logo CID + logo scuola, riepilogo, CTA) — best-effort |
| `scripts/send-portal-live-test.ts` | invio test con dati reali Siotto Pintor |

## Env

| Var | Note |
|---|---|
| `SALEOR_ADMIN_EMAIL` / `SALEOR_ADMIN_PASSWORD` | credenziali admin (vedi kyron-ecommerce-ops) |
| `SALEOR_STAGING_URL` / `SALEOR_PROD_URL` | default api-staging/api.kyronedu.it |
| `RESEND_API_KEY` | stessa del cms (gia' su Coolify per analytics) |
| `PORTAL_LIVE_NOTIFY_TO` | CSV; default `info@kyronedu.it,gmail@alekdob.com` |
| `KYRON_OPS_URL` / `KYRON_OPS_TOKEN` | endpoint + bearer del servizio kyron-ops (decision-020); assenti = integrazione no-op (enable non si rompe) |

## Frontend (studio)

| File | Ruolo |
|---|---|
| `studio/src/components/portals/EnablePortalButton.tsx` | bottone + report per target |
| `studio/src/app/api/portals/[slug]/enable/route.ts` | proxy (maxDuration 180) |
| `studio/src/lib/gateway.ts` | `enablePortalOnSaleor()` |

## Tool agente (modifiche commerciali, 2026-06-12)

| Tool | Scopo |
|---|---|
| `update_catalog` | sostituisce visibleSlugs e/o visibleVariants (liste complete) |
| `update_discounts` | sostituisce productDiscounts con sanity vs listino (eur=prezzo FINALE, percent 1-90). Per prodotti multi-taglio (iPad/MacBook) uno sconto `eur` DEVE avere `capacity` (vedi gotcha sotto) |
| `apply_to_saleor` | enablePortal su staging+prod; mail go-live solo al primo publish; report con sconti_attivi |

L'enable e' DECLARATIVO: i prodotti sul channel non piu' nel piano vengono
`hidden-blocked` (riconciliazione rimozioni). Writer: `patchPortalCatalog`.

## Test

`tests/features/portals-enable-config.test.ts` — mapping selection + convenzione
voucherCodeFor (deve matchare CLI/storefront). Verifica e2e: bottone su portale
reale dopo deploy + env.

## kyron-ops: chiusura self-service (decision-020)

L'enable gira in rete isolata e non puo' toccare recalc Saleor ne' la config Stripe
(DynamoDB app Stripe) da solo. `ops-client.ts` delega a **kyron-ops** (servizio interno
nei container). L'orchestratore, dopo `markOnboarded`:

- `opsRecalc()` — SOLO se `config.catalog.productDiscounts.length > 0` (i kit a solo voucher non ne hanno bisogno); materializza le Promotion sul pricing (rimpiazza il recalc manuale)
- `opsAssignStripe(channelId)` — SOLO al primo go-live (`portal.status !== "onboarded"`); assegna la config Stripe "Kyron live" al channel

Entrambi **best-effort**: senza `KYRON_OPS_URL/TOKEN` sono no-op, e un errore NON rompe
l'enable (il portale resta seedato). Gli esiti finiscono in `EnableReport.ops.{recalc,stripe}`.
Cross-ref: `Kyron/documentation/decisions/decision-020-kyron-ops-privileged-operations.md`.

## Gotcha ereditati (dal seed CLI)

- hidden-but-purchasable: `isPublished:true, visibleInListings:false, isAvailableForPurchase:true`
- promo `eur`: baseline = `priceUndiscounted` (listino pieno), channel riallineato prima della promo. La sanity di `normalize.checkDiscounts` usa la baseline PER-TAGLIO (`baselineForDiscount`), non il min del prodotto — vedi gotcha 2026-07-10
- voucher: `applyOncePerOrder:false` o lo sconto FIXED si cappa sulla riga piu' economica
- il beat celery NON sempre applica le Promotion da solo: `promotionsOnSale:false` nel report = serve recalc. Ora automatizzato via `opsRecalc` (kyron-ops, decision-020) quando il piano ha sconti; se kyron-ops non e' configurato resta manuale
- **recalc manuale (path import cambiati in questa versione Saleor, verificato 2026-07-08)**: il vecchio `saleor.discount.utils.promotion import update_variant_relations_for_active_promotion_rules_task` NON esiste piu' (ImportError). Path corretti: `from saleor.discount.tasks import set_promotion_rule_variants_task` + `from saleor.product.utils.variant_prices import update_discounted_prices_for_promotion` + `from saleor.product.models import Product`, poi `set_promotion_rule_variants_task()` (collega varianti↔regola) e `update_discounted_prices_for_promotion(Product.objects.all())`. Container prod api = `api-rn5te82k0yswv28s63z2o85s`

## Gotcha: sconto EUR su prodotto multi-taglio richiede capacity (fix 2026-07-08)

**Sintomo**: uno sconto in EUR chiesto per un taglio di un prodotto multi-variante (es. "iPad A16 256 a 599") non arriva MAI su Saleor, ma l'agente riporta "sconto aggiunto".

**Causa** (`update_discounts` in `onboard-school/agent.ts`): con `capacity` mancante, il matching cercava il prodotto per `slug` e prendeva la PRIMA variante (iPad 128GB, listino 509). Il check `finale >= listino` (599 >= 509) scartava lo sconto in silenzio come "resta a listino", e l'agente leggeva successo. Anche se fosse stato tenuto, `applyDiscounts` in enable lancia comunque su "eur su multivariante senza capacity".

**Fix**: uno sconto `eur` su prodotto multi-taglio SENZA capacity ora e' un errore chiaro ("specifica il taglio, es. '256gb'") invece del silent-drop; descrizione+param `capacity` istruiscono l'agente a ricavare SEMPRE il taglio dal testo ('256' -> '256gb'). Commit `edfd485` + `cc450b6`.

**Incidente de-amicis**: iPad A16 256GB restava 639€ invece di 599€. Fix prod: Promotion FIXED -40€ creata a mano su Saleor + recalc. Il descriptor Payload aveva perso ENTRAMBI gli sconti iPad (update_discounts sostituisce la lista + applyDiscounts e' upsert-only e non rimuove le promo omesse -> drift descriptor↔Saleor); riallineato con `scripts/realign-de-amicis-256.ts`.

## Gotcha: baseline sconto EUR era capacity-blind (fix 2026-07-10)

**Sintomo**: uno sconto `eur` su un taglio ALTO di un prodotto multi-variante spariva
a ogni enable, anche con `capacity` corretto. Es. iPad A16 256GB → 599€ (portale
majorana): il descriptor lo aveva, ma dopo `enablePortal` il 256 restava a 639€ pieno
e la voce spariva dal doc Payload (`markOnboarded` ripersiste il catalogo normalizzato).

**Causa** (`normalize.ts:checkDiscounts`): la baseline di validazione era
`product.minPriceEur` = prezzo del taglio PIÙ ECONOMICO (iPad 128 = 509), **ignorando
la capacity dello sconto**. Per il 256 valutava `599 >= 509` → lo classificava
"finale ≥ listino, nessuno sconto" e lo scartava in silenzio. Diverso dal fix
2026-07-08 (che imponeva la presenza di `capacity`): lì il taglio c'era, ma la
baseline restava sbagliata.

**Fix** (commit `ac9fb27`): `baselineForDiscount(product, capacity)` — se lo sconto ha
un taglio, la baseline è il listino minimo delle SOLE varianti di quel taglio (prezzi
per-variante ora letti da Saleor in `fetchCatalogIndex`), fallback al `minPriceEur`.
Dopo il redeploy, l'enable mantiene lo sconto (`promo eur: ipada16-256gb 639 -> 599`).

**Due gap correlati emersi nello stesso incidente (majorana 2026-07-10):**

- **Promo orfane al cambio valore**: `upsertPromotion` (seed-steps) cerca la promo
  esistente per NOME, e il nome include il valore (`Kyron <slug> <prod> <N>EUR`).
  Se il prezzo cambia (es. cover 23→24), crea una promo nuova ma NON cancella la
  vecchia; restano più Promotion CATALOGUE sulla stessa variante e Saleor applica la
  PIÙ BASSA → il prezzo "si blocca" al valore vecchio. Fix majorana: cancellate a mano
  le promo `coverone` stale (23EUR + -20%), tenuta solo `24EUR`, poi recalc. Bonifica
  di massa da valutare (visto anche `santomauro` con 24EUR duplicato).
- **Enable de-lista solo per prodotto intero, non per taglio**: la riconciliazione
  rimozioni (`applyVisibilityAndPricing` → `listChannelProductSlugs`) è per-slug. Un
  taglio tolto da `visibleVariants` (es. iPad 512) NON viene de-listato se il prodotto
  resta a catalogo → resta acquistabile/visibile. In Saleor 3.23 non c'è delete listing
  per-variante: usare `productChannelListingUpdate(id, input:{updateChannels:[{channelId, removeVariants:[...]}]})`.

## Money-path: allowUnpaidOrders sul channel (fix 2026-07-01)

**Sintomo**: checkout **bonifico** / **carta del docente** su un portale fallisce con
`Provided payment methods can not cover the checkout's total amount` (bonifico) o
`CHECKOUT_NOT_FULLY_PAID` (carta docente → ordine orfano, Stripe incassato ma ordine mai creato).
Gli ordini a **carta** passano lo stesso → bug invisibile finche' nessuno prova un metodo offline.

**Causa**: `ensureChannel` creava il channel SENZA `orderSettings`, quindi `allowUnpaidOrders=false`.
I pagamenti offline materializzano ordini NON pagati; Saleor li rifiuta senza quel flag.
Esistono due path di creazione channel: `ecommerce/seed/lib/saleor-channel.ts` (path .md, aveva
gia' il flag dal commit `7867e9f`) e QUESTO (`seed-steps.ts`, path attivo via Studio/Payload, che
NON lo settava). I portali nascono da questo → nascevano tutti rotti per l'offline.

**Fix**: `channelCreate` ora passa `orderSettings:{allowUnpaidOrders:true, automaticallyConfirmAllNewOrders:true}`.
Incidente 2026-07-01: 14 channel prod (id 11-24: bertoni, bettolo, dorotea, farina, fermi, gallio,
maffei, majorana, nievo, paolo-vi, respighi, righi, rodari, vogelweide) backfillati a mano via Django
shell prima del fix. **Caveat**: il branch "channel gia' esistente" ritorna early e NON re-setta il flag —
se un channel esistente perde il flag va rifatto a mano o via `ecommerce/seed/enable-unpaid-orders.ts`.
Cross-ref: `ecommerce/documentation/features/026-offline-payment-methods.md`,
`ecommerce/documentation/gotchas/gotcha-carta-docente-channel-missing-allow-unpaid-orphan.md`.
