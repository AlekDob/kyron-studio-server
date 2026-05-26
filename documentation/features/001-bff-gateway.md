---
type: feature
project: kyron-studio-server
created: 2026-05-26
last_verified: 2026-05-26
tags: [gateway, payload, bff, hono, multitenancy, workstream-02]
---

# 001 — BFF Gateway Payload

## Cosa

Gateway BFF su Hono che espone le collection Payload come REST normalizzato a
Studio (frontend + chat agente). Auth a 2 livelli: `X-Tenant` header per
routing tenant + cookie `kyron-rev` HMAC per identita' utente. Service-to-service
verso Payload via API Key utente "studio-service".

## Stato

Phase 1 workstream 02 — done 2026-05-26. Live in dev su `:8790/api/v1/collections`.
8 collection registrate (5 editable + 3 read-only).

## Endpoint

```
GET    /api/v1/collections                 → { data: [{slug, label, count, …}] }
GET    /api/v1/collections/:slug           → { data: [...docs], meta, collection }
GET    /api/v1/collections/:slug/:id       → { data: {...doc} }
POST   /api/v1/collections/:slug           → 201 { data: doc }   (editable only)
PATCH  /api/v1/collections/:slug/:id       → { data: doc }       (editable only)
DELETE /api/v1/collections/:slug/:id       → { id }              (editable only)
```

Tutte le route richiedono: `X-Tenant: kyron` + cookie `kyron-rev` valido (HMAC
`KYRON_REVIEW_SECRET`).

## Collection registry

`src/features/collections/registry.ts`:

| Slug | Purpose | Editable |
|---|---|---|
| bandi | manage | yes |
| eventi | manage | yes |
| products | manage | yes |
| brands | manage | yes |
| product-categories | manage | yes |
| media | library | no |
| contact-submissions | inbox | no |
| product-request-submissions | inbox | no |

Estendere: append a `COLLECTIONS` + (se editable) garantire che Payload
accetti `PATCH/POST` via API Key con i field schema corrispondenti.

## File chiave

| File | Ruolo |
|---|---|
| `src/middleware/studio-auth.ts` | Validazione cookie kyron-rev HMAC |
| `src/core/tenant/middleware.ts` | Validazione X-Tenant header |
| `src/core/payload/gateway.ts` | Client HTTP generico Payload REST + search field map |
| `src/features/collections/registry.ts` | Metadata collection (slug, label, purpose, editable) |
| `src/features/collections/route.ts` | Hono CRUD handler |
| `src/config/tenants/kyron.ts` | Config tenant Kyron (URL Payload + API Key) |

## Search per-collection

`buildListUrl` mappa il param `q` ai field giusti per ogni collection (Payload
ritorna 400 se interroghi un field inesistente):

| Slug | Search fields |
|---|---|
| bandi, eventi | titolo, slug |
| products, brands, product-categories | name, slug |
| media | filename, alt |
| contact-submissions, product-request-submissions | email, name |

## Auth setup (one-time)

1. In Payload admin → Users → crea `studio-service@kyronedu.it`
   role `service`, `enableAPIKey: true`
2. Script idempotente: `cms/scripts/create-studio-service.mjs`
3. Output: `TENANT_KYRON_PAYLOAD_API_KEY=...` in `studio-server/.env`
4. `KYRON_REVIEW_SECRET` deve matchare quello di `cms/.env`

## Gotcha

- **Payload schema drift**: in dev `payload.update` rivalida l'intero
  documento → 400 su field obsoleti. Workaround in `cms/lib/studio/data/`
  (raw SQL) — qui non applicabile perche' chiamiamo la REST. Soluzione: dopo
  modifica schema, `PAYLOAD_PUSH=true npm run dev` nel cms.
- **API Key auth**: header e' `Authorization: users API-Key {key}` (con
  prefisso `users `, non `Bearer`). Document type Payload-specific.
- **`Authorization` con API Key bypassa access control**: il middleware
  `studio-auth.ts` verifica l'utente Studio MA le chiamate al Payload girano
  con privilegi service → non c'e' RBAC granulare per ora. Da rivedere quando
  ci saranno ruoli editor diversi.

## Vedi anche

- `Kyron/documentation/decisions/decision-014-studio-bff-gateway.md`
- `Kyron/documentation/workstreams/02-studio-agentic-data-layer.md`
- `studio-server` feature 002 (data-editor agent che usa questo gateway)
