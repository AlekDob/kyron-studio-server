---
type: feature
project: studio-server
created: 2026-06-10
last_verified: 2026-06-12
tags: [analytics, posthog, hogql, cache]
---
# 005 — Analytics gateway (PostHog HogQL)

**Status**: implemented (locale, da deployare)
**Decision**: `Kyron/documentation/decisions/decision-017-analytics-posthog.md`
**Frontend**: studio feature 009

## Endpoint

`GET /api/v1/analytics/overview?range=7d|30d|90d` — tenantMiddleware + studioAuthMiddleware (tutti gli utenti Studio: aggregati read-only, no PII).

Risposta `AnalyticsOverview`: `totals`, `byApp{cms,storefront}`, `tenants[]` (TenantRow con label/known/conversionRate), `timeseries[]` (per giorno+app), `stale`.

## File

| File | Ruolo |
|---|---|
| `src/features/analytics/types.ts` | shape payload + RANGE_DAYS |
| `src/features/analytics/posthog.ts` | client Query API (`POST /api/projects/{id}/query`, Bearer personal key). Errori tipizzati Config/Query |
| `src/features/analytics/queries.ts` | 2 query HogQL: breakdown `GROUP BY app, school_slug` + timeseries `GROUP BY day, app`. `days` da enum chiuso |
| `src/features/analytics/cache.ts` | TTL cache 5 min con `getStale` |
| `src/features/analytics/service.ts` | orchestrazione: cache → single-flight → join dinamico con `listPortals()` → stale-on-error |
| `src/features/analytics/route.ts` | Zod su range; 503 `posthog_not_configured`, 502 `posthog_error` |

## Join dinamico (cuore della feature)

- `app=cms` → riga unica "Sito kyronedu.it"
- `school_slug=demo` → "Shop principale", pinnato in testa agli shop
- slug nei portali Payload → nome scuola, `known:true`
- slug PostHog non onboardato → label=slug, `known:false` (traffico senza portale)
- portale onboardato a traffico zero → riga zero-filled (i nuovi shop appaiono subito)
- Payload giu' → analytics funziona comunque (nomi = slug)

Test: `tests/features/analytics/service.test.ts` (6 casi).

## Rate limit PostHog

Query API ~120 query/h per personal key → 2 sole query per fill, TTL 5 min, single-flight: worst case 72/h con tutte e 3 le range fredde ogni 5 min.

## Env

```
POSTHOG_API_KEY=     # personal API key scope query:read (SEGRETO, != token phc_ pubblico)
POSTHOG_PROJECT_ID=
POSTHOG_HOST=https://eu.posthog.com
```

Senza chiave: 503 → il frontend mostra lo stato "non configurata" (mai crash).

## Estensione 2026-06-12 — range calendario, confronti, geo/fonti/pagine/device, report email

**Status**: live in prod (commit `375d6e1`)

### Endpoint aggiornati

| Endpoint | Note |
|---|---|
| `GET /api/v1/analytics/overview?range=today\|yesterday\|week\|month\|7d\|30d\|90d` | payload esteso (sotto) |
| `POST /api/v1/analytics/report/send` | trigger manuale report email, **requireAdmin** |

### Payload esteso

| Campo | Origine | Note |
|---|---|---|
| `granularity` | RANGE_WINDOWS | `hour` per today/yesterday (timeseries oraria), altrimenti `day` |
| `leads` | Query C | `{formSubmits, newsletterSubs, registrations, forms[]}` |
| `prev` | Query D | totali periodo precedente per-app + lead (delta card KPI) |
| `geo` | Query E | citta' GeoIP: `{city\|null, country, lat, lon, visitors}` top 60 |
| `sources` | Query F | `utm_source > $referring_domain > $direct`, top 20 |
| `pages` | Query G | `$pathname` top 15 per pageview |
| `devices` | Query H | `$device_type` (Desktop/Mobile/Tablet) |

8 query HogQL per fill cache (TTL 5 min) — rate limit Query API ~120/h: occhio ad aggiungerne altre.

### Finestre temporali (queries.ts `RANGE_WINDOWS`)

- Confini calendario in HogQL (`toStartOfDay`/`toMonday`/`toStartOfMonth`) nella **timezone del project PostHog** (impostare Europe/Rome nelle settings).
- Periodo precedente = stessa durata trascorsa subito prima di `from`: `addSeconds(from, -dateDiff('second', from, to))` (verificata live).
- Filtro PROD su TUTTE le query: `properties.$host IN ('kyronedu.it','www.kyronedu.it')` — il project e' condiviso con staging/smoke test.

### Report email giornaliero (`report.ts`)

- Overview di IERI → HTML email-safe sul template ufficiale skill `kyron-email` (card 600px, logo, Helvetica, CTA bulletproof).
- **Logo come allegato inline cid** (`attachments[].content_id`): l'URL remoto e' bloccato dai client privacy; width 110 SIA attributo SIA inline style (Apple Mail ignora il solo attributo sulle cid).
- Invio Resend: from `Kyron <web@kyronedu.it>`, reply-to `info@kyronedu.it`, destinatari `ANALYTICS_REPORT_TO` (default info@kyronedu.it + gmail@alekdob.com).
- Scheduler in-process alle **09:00 Europe/Rome**: tick 30s, invio al primo tick con ora 9 (catch-up se il container riparte entro le 09:59), retry al tick successivo su errore. Opt-in `ANALYTICS_REPORT_ENABLED=true`.

### Env aggiuntive

| Var | Scopo |
|---|---|
| `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` / `POSTHOG_HOST` | Query API (personal key scope query:read) |
| `RESEND_API_KEY` | invio report (stessa key del cms) |
| `ANALYTICS_REPORT_ENABLED` | `true` arma lo scheduler |
| `ANALYTICS_REPORT_TO` | CSV destinatari (opzionale) |

### Test

`tests/features/analytics/service.test.ts` — 10 test: `buildTenants` (join dinamico), `buildLeads`, `buildPrev`. Smoke script: `scripts/report-test.ts` (renderizza l'HTML in /tmp con dati reali).
