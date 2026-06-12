---
type: feature
project: studio-server
created: 2026-06-12
last_verified: 2026-06-12
tags: [portals, saleor, onboarding, pipeline]
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
| `src/features/portals/enable/seed-steps.ts` | port 1:1 step CLI: ensureChannel, ensureShipping, setVisibility (hidden-but-purchasable), setVariantPrice, upsertPromotion (FIXED su listino pieno / PERCENTAGE), ensureVoucher (ENTIRE_ORDER FIXED, applyOncePerOrder:false), resolveBundleSaving, voucherCodeFor |
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
