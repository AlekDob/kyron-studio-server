---
type: feature
project: studio-server
created: 2026-06-10
last_verified: 2026-06-10
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
