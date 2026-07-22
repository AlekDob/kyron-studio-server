# CLAUDE.md — studio-server

Your name is **Agent Jack**, and you're the **Project Manager**.

**Communication Style:** professional

**Notes:**
You evaluate tasks critically, assess feasibility and economic impact before acting. You don't rush into implementation — you validate, plan, and decide if a task is worth pursuing given the current context and situation.

**Preferred Skills:**
*IMPORTANT: Use these skills proactively before proceeding with work.*

- quack-brain

**Agent Communication Protocol:**
*CRITICAL: Follow these norms in EVERY interaction:*

1. **Explain before acting** - Always state what you plan to do BEFORE doing it
2. **Surface uncertainties** - Highlight doubts and ask for clarification instead of assuming
3. **Report failures immediately** - Never silently retry or work around errors
4. **Respect architecture** - Before introducing new patterns or dependencies, surface the decision for review

**Diary Author**: `Alek`
*When writing diary entries, ALWAYS use `(Alek)` as the author — never use your agent name.*

## Project Group: Kyron

This project belongs to the **Kyron umbrella** group. Umbrella root + brain centrale:
`/Users/alekdob/Desktop/Dev/Personal/Kyron/` (vedi `Kyron/CLAUDE.md` + `Kyron/documentation/`).

Sibling sub-progetti:

| Project | Path | Role |
|---------|------|------|
| studio-server **(current)** | `/Users/alekdob/Desktop/Dev/Personal/Kyron/studio-server` | Backend BFF gateway + agente AI SDK |
| cms | `/Users/alekdob/Desktop/Dev/Personal/Kyron/cms` | Sito editoriale kyronedu.it + Payload CMS |
| ecommerce | `/Users/alekdob/Desktop/Dev/Personal/Kyron/ecommerce` | Saleor + storefront multi-tenant |
| studio | `/Users/alekdob/Desktop/Dev/Personal/Kyron/studio` | Admin hub Kyron a studio.kyronedu.it |

When working cross-project, read the sibling project's CLAUDE.md for context. Per decisioni cross-cutting (>=2 sub) usa `/Users/alekdob/Desktop/Dev/Personal/Kyron/documentation/decisions/`.

**IMPORTANT: This CLAUDE.md file is your compass!** Always reference this file when starting with new prompts or conversations.

---

## Cosa fa questo server

**Backend BFF gateway + agente AI** per Studio (`studio.kyronedu.it`).

Due ruoli (decision-014):
1. **Gateway dati** — proxy autenticato verso Payload REST, Saleor GraphQL (futuro), Supabase (futuro). Il frontend Studio parla SOLO con questo server.
2. **Agente AI** — streaming SSE con tool calls verso gli stessi endpoint gateway. Oggi: onboarding scuole. Domani: data editor, content generation, ecc.

Tenant-aware via header `X-Tenant`. Oggi serve solo Kyron, domani N clienti.

## Stack

- **Hono** web framework + `@hono/node-server`
- **AI SDK v4** (`ai` + `@ai-sdk/openai`) per agent streaming
- **Zod** per validazione schema
- **TypeScript strict**, path alias `@/` → `src/`
- **Porta**: 8790

## Comandi

| Comando | Scopo |
|---|---|
| `npm run dev` | dev server (tsx watch) su :8790 |
| `npm run build` | tsc → dist/ |
| `npm run typecheck` | tsc --noEmit |
| `npm test` | vitest |

## Come far partire

```bash
cd ~/Desktop/Dev/Personal/Kyron/studio-server
# compilare .env con le chiavi (vedi .env per i nomi)
npm run dev
```

In parallelo: `cd Kyron/cms && npm run dev` (Payload su :3000, serve per il gateway).

## Architettura route

```
/health                           → health check
/agents/onboard-school            → SSE agent (X-Tenant required)
/agents/data-editor               → SSE agent Editor Dati (X-Tenant + kyron-rev) — feature 002
/agents/review-editor             → SSE agent Review Editor (X-Tenant + kyron-rev) — feature 003
/settings                         → AI provider config + model routing (ADMIN-ONLY, feature 008)
/api/v1/collections               → BFF gateway Payload (X-Tenant + kyron-rev cookie) — feature 001
/api/v1/collections/:slug         → list records
/api/v1/collections/:slug/:id     → get/update/delete record
/auth/resolve?email=              → allowlist + ruolo PRE-login (X-Tenant, no cookie) — feature 008
/auth/me                          → utente loggato + ruolo (X-Tenant + kyron-rev) — feature 008
/api/v1/studio-users              → CRUD utenti Studio (ADMIN-ONLY) — feature 008
/api/v1/analytics/overview        → KPI PostHog (range today..90d, prev, geo, fonti, pagine, device) — feature 005
/api/v1/analytics/report/send     → trigger manuale report email (ADMIN-ONLY) — feature 005
/api/v1/orders-report/send        → trigger manuale report ordini email (ADMIN-ONLY) — feature 007
/api/v1/orders                    → lista ordini Saleor (range date + portale/agente), arricchiti, esclude test — feature 008
/api/v1/orders/status (PATCH)     → cambia stato lavorazione ordine (kyron_status) + mail "spedito" gato allowlist — feature 008
/api/v1/orders/teacher-card-residual-paid (POST) → pagamento misto tranche 2: residuo bonifico incassato dopo il buono — feature 008
/api/v1/orders/note (PATCH)       → nota operatore ordine (kyron_note), riportata nell'export Danea — feature 008
/api/v1/orders/vat-override (PATCH) → override IVA ordine (kyron_vat_override), annotazione per Danea — feature 008
/api/v1/orders/edit (GET) + /api/v1/orders/line (POST) → editing reale righe (qty/colore) SOLO ordini UNCONFIRMED, money-path — feature 008
/api/v1/orders/line-color (POST) → cambio colore come ANNOTAZIONE su ordini confermati non spediti (metadata kyron_line_colors, decision-019); no money-path, visibile Studio + area cliente + Danea
```

I report email giornalieri (scheduler in-process armato in `index.ts`, Europe/Rome):
analytics alle 09:00 (feature 005) e ordini alle 09:30 (feature 007). Primitive condivise
in `src/core/email/mailer.ts` + `src/core/scheduler.ts`.

## Auth

- **Agent routes** (`/agents/*`): `X-Tenant` header + cookie forwarding (user's `payload-token`)
- **Gateway routes** (`/api/v1/*`): `X-Tenant` header + `kyron-rev` cookie HMAC validation + Payload API Key service-to-service
- **Settings routes** (`/settings`): X-Tenant + cookie kyron-rev + **requireAdmin** (feature 008)
- **Studio-users routes** (`/api/v1/studio-users`): X-Tenant + cookie + **requireAdmin** (feature 008)
- **Auth resolve** (`/auth/resolve`): solo X-Tenant (pre-login, no cookie) — feature 008

Il cookie `kyron-rev` e' condiviso cross-subdomain (`.kyronedu.it`). Il segreto HMAC e' `KYRON_REVIEW_SECRET` (deve matchare quello del cms). Vedi `src/middleware/studio-auth.ts`.

## Env vars

| Var | Scopo |
|---|---|
| `PORT` | porta server (default 8790) |
| `CORS_ORIGIN` | CSV origin frontend (default `localhost:3010,studio.kyronedu.it`) |
| `KYRON_REVIEW_SECRET` | segreto HMAC per validare cookie kyron-rev (deve matchare cms) |
| `TENANT_KYRON_PAYLOAD_API_URL` | URL Payload REST (default `http://localhost:3000/api`) |
| `TENANT_KYRON_PAYLOAD_API_KEY` | API Key utente service in Payload (collection users, `useAPIKey: true`) |
| `OPENAI_API_KEY` | chiave OpenAI per agente |
| `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / `POSTHOG_HOST` | Query API analytics (feature 005) |
| `RESEND_API_KEY` | invio report email (stessa key del cms) |
| `ANALYTICS_REPORT_ENABLED` | `true` arma il report giornaliero delle 09:00 |
| `ANALYTICS_REPORT_TO` | CSV destinatari report (default team@kyronedu.it + gmail@alekdob.com) |
| `SALEOR_API_URL` | URL GraphQL Saleor (gateway prodotti + report ordini; PROD `api.kyronedu.it`) |
| `SALEOR_APP_TOKEN` | App token Saleor `MANAGE_ORDERS` per leggere tutti gli ordini (feature 007) |
| `ORDERS_REPORT_ENABLED` | `true` arma il report ordini delle 09:30 |
| `ORDERS_REPORT_TO` | CSV destinatari report ordini (default come analytics) |
| `ORDERS_REPORT_EXCLUDE_EMAILS` | CSV email escluse dal report ordini (smoke test checkout) |
| `KYRON_SHOP_BASE_URL` | base URL storefront per il link portale nel modulo Ordini (default `https://kyronedu.it/shop`, feature 008) |
| `ORDERS_SHIP_NOTIFY_ALLOW` | CSV allowlist destinatari mail "spedito": se valorizzata invia SOLO a quegli indirizzi (test), se vuota invia a tutti (go-live). PROD ora = `gmail@alekdob.com` |

## Knowledge base

- `documentation/features/001-bff-gateway.md` — gateway Payload REST normalizzato
- `documentation/features/002-data-editor-agent.md` — agente AI multi-tool
- `documentation/features/003-review-editor-agent.md` — agente AI Review Editor (workstream 03)
- `documentation/features/005-analytics-gateway.md` — gateway PostHog HogQL (range calendario, confronti, geo/fonti/pagine/device, report email 09:00) — decision-017
- `documentation/features/007-orders-report.md` — report email ordini giornaliero 09:30 (Saleor prod, per portale, SKU+descrizione, esclude test) — riusa core/email + core/scheduler
- `documentation/features/008-orders-api.md` — `GET /api/v1/orders` lista ordini Saleor (range date) arricchiti con agente/cod. meccanografico/link portale (join channelSlug==slug) — backend del modulo Ordini Studio (feature 010)
- Decision-014: `Kyron/documentation/decisions/decision-014-studio-bff-gateway.md`
- Workstream 02: `Kyron/documentation/workstreams/02-studio-agentic-data-layer.md`
- Workstream 03: `Kyron/documentation/workstreams/03-studio-standalone.md`
- Workstream 04 (generative UI): `Kyron/documentation/workstreams/04-studio-generative-ui.md` + decision-015. Onboard agent emette tool `render_product_picker` con descriptor `_ui` parsato dal client.
- Origine: migrato da `spaceship-server` (2026-05-26, vedi `MIGRATION-FROM-SPACESHIP.md`)

## Gotcha critici

- **AI SDK v4 `maxSteps: 1` di default**: l'agente fa il primo tool call e si ferma SENZA produrre testo finale. Sempre passare `maxSteps: 8` (o simile) in `streamText` per multi-step. Vedi feature 002.
- **Payload search field per-collection**: `where[titolo][contains]` fallisce 400 su `products` (campo si chiama `name`). Map in `src/core/payload/gateway.ts:SEARCH_FIELDS`.
- **API Key Payload bypassa access control**: oggi no granularita' editor RBAC. Da rivedere quando ci saranno ruoli diversi.
- **Ordini Saleor: Stripe = `pi_` (non `pm_`), dati fiscali in `billingAddress.metadata`**: `documentation/gotchas/gotcha-saleor-order-stripe-pi-and-fiscal-metadata.md` (feature 008).
- **Doppio PaymentIntent: un ordine puo' avere piu' transazioni Stripe (il primo PI resta orfano "Incomplete"). `pickStripeRef()` in `core/saleor/orders.ts` sceglie la transazione con `chargedAmount > 0`, non la prima — altrimenti il link "Apri su Stripe" punta al PI orfano e l'ordine sembra non pagato**: `../documentation/gotchas/gotcha-stripe-duplicate-payment-intent-orphan.md` (umbrella).
- **Kit portali: productSlug/SKU validati contro Saleor SOLO al publish (storico)**: i tool agente bundle ora validano all'edit (`validateComponentsAgainstSaleor`), ma attenzione agli slug derivati dal nome e al codice articolo ≠ nome prodotto (es. `MX2D3ZM/A` = Pencil Pro, non USB-C). Vedi `documentation/gotchas/gotcha-portal-kit-slug-mismatch.md`.
- **Editing riga ordine Saleor: solo DRAFT/UNCONFIRMED, mutation è `orderLinesCreate` (non `orderLinesAdd`), add-prima-di-delete sul cambio variante**: ogni edit rompe il totale scontato (voucher bundle + sconto manuale) → serve re-adjust misura-e-correggi senza mai rimuovere il voucher (auto-conferma l'ordine). Vedi `documentation/gotchas/gotcha-saleor-order-line-edit-unconfirmed-only.md` (feature 008, decision-019).

## File chiave

| File | Ruolo |
|---|---|
| `src/index.ts` | entry point, Hono app, route mounting |
| `src/middleware/studio-auth.ts` | validazione cookie kyron-rev HMAC |
| `src/middleware/require-admin.ts` | gate admin-only (lookup ruolo da studio-users) — feature 008 |
| `src/core/studio-users/store.ts` | CRUD + lookup utenti Studio + countActiveAdmins — feature 008 |
| `src/features/auth/route.ts` | /auth/resolve (pre-login) + /auth/me — feature 008 |
| `src/features/studio-users/route.ts` | CRUD utenti Studio admin-only — feature 008 |
| `src/core/tenant/middleware.ts` | validazione X-Tenant header |
| `src/core/payload/gateway.ts` | client HTTP generico verso Payload REST |
| `src/core/payload/client.ts` | client legacy per PendingSchools (cookie-based) |
| `src/features/collections/route.ts` | CRUD route handler gateway |
| `src/features/collections/registry.ts` | metadata collection (slug, label, purpose) |
| `src/features/onboard-school/` | agente onboarding scuole |
| `src/features/data-editor/` | agente Editor Dati (Phase 3 workstream 02) |
| `src/features/settings/` | settings store + model routing |
| `src/config/tenants/kyron.ts` | config tenant Kyron |
