---
type: feature
project: studio-server
created: 2026-06-12
last_verified: 2026-07-01
tags: [portals, saleor, onboarding, pipeline, unpaid-orders, offline-payments, money-path]
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
| `src/features/portals/enable/enable.ts` | orchestratore per target + buildPubPlans + poll onSale 75s + guard channelId divergenti + markOnboarded su Payload |
| `src/features/portals/enable/notify.ts` | mail "portale live" (template kyron-email, logo CID + logo scuola, riepilogo, CTA) — best-effort |
| `scripts/send-portal-live-test.ts` | invio test con dati reali Siotto Pintor |

## Env

| Var | Note |
|---|---|
| `SALEOR_ADMIN_EMAIL` / `SALEOR_ADMIN_PASSWORD` | credenziali admin (vedi kyron-ecommerce-ops) |
| `SALEOR_STAGING_URL` / `SALEOR_PROD_URL` | default api-staging/api.kyronedu.it |
| `RESEND_API_KEY` | stessa del cms (gia' su Coolify per analytics) |
| `PORTAL_LIVE_NOTIFY_TO` | CSV; default `info@kyronedu.it,gmail@alekdob.com` |

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
| `update_discounts` | sostituisce productDiscounts con sanity vs listino (eur=prezzo FINALE, percent 1-90) |
| `apply_to_saleor` | enablePortal su staging+prod; mail go-live solo al primo publish; report con sconti_attivi |

L'enable e' DECLARATIVO: i prodotti sul channel non piu' nel piano vengono
`hidden-blocked` (riconciliazione rimozioni). Writer: `patchPortalCatalog`.

## Test

`tests/features/portals-enable-config.test.ts` — mapping selection + convenzione
voucherCodeFor (deve matchare CLI/storefront). Verifica e2e: bottone su portale
reale dopo deploy + env.

## Gotcha ereditati (dal seed CLI)

- hidden-but-purchasable: `isPublished:true, visibleInListings:false, isAvailableForPurchase:true`
- promo `eur`: baseline = `priceUndiscounted` (listino pieno), channel riallineato prima della promo
- voucher: `applyOncePerOrder:false` o lo sconto FIXED si cappa sulla riga piu' economica
- il beat celery NON sempre applica le Promotion da solo: `promotionsOnSale:false` nel report = serve recalc manuale

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
