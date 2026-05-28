---
type: feature
project: studio-server
created: 2026-05-28
last_verified: 2026-05-28
status: live
tags: [portals, payload, gateway, ws-05, decision-016, persistence, pending-schools]
---

# 004 — Portals gateway (Payload-backed)

## Cosa

Layer di lettura/scrittura per i portali scuola (modulo Studio "Portali")
sopra la collection Payload `pending-schools`. Sostituisce il vecchio
filesystem `.md` (decision-016, WS05).

Espone:

| Route studio-server | Funzione | Payload upstream |
|---|---|---|
| `GET /api/v1/portals` | `listPortals()` | `GET /api/pending-schools?sort=-updatedAt&limit=200` |
| `GET /api/v1/portals/:slug` | `getPortal()` | `GET /api/pending-schools?where[slug][equals]=:slug` |
| `PUT /api/v1/portals/:slug` | `updatePortal()` | `PATCH /api/pending-schools/:id` (campi top-level + group schoolAddress) |
| `DELETE /api/v1/portals/:slug` | `deletePortal()` | `DELETE /api/pending-schools/:id` |
| `PUT /api/v1/portals/:slug/catalog` | `updatePortalCatalog()` | `PATCH /api/pending-schools/:id` (group catalog) |
| `PUT /api/v1/portals/:slug/bundles/:bundleSlug` | `updateBundleInPortal()` | `PATCH /api/pending-schools/:id` (intero array bundles) |
| `DELETE /api/v1/portals/:slug/bundles/:bundleSlug` | `removeBundleFromPortal()` | `PATCH /api/pending-schools/:id` (array filtered) |
| `POST /api/v1/portals/:slug/logo` | `savePortalLogo()` | `POST /api/media` (multipart) + `PATCH /api/pending-schools/:id` (branding.logo = mediaId) |
| `GET /api/v1/portals/_catalog` | `fetchSaleorProducts()` | Saleor GraphQL (passthrough) |

## File chiave

| File | Ruolo |
|---|---|
| `src/features/portals/gateway.ts` | Singleton lazy `getPortalsGateway()` su `kyronTenant`. Costante `PORTALS_COLLECTION = "pending-schools"`. |
| `src/features/portals/reader.ts` | `listPortals`, `getPortal`, `findPortalDoc`, `resolvePortal` (fuzzy slug+nome in-memory). Mapping `PortalSummary`/`PortalDetail`. |
| `src/features/portals/writer.ts` | PATCH parziali Payload. Array `bundles` con read-modify-write + strip `id` Payload-managed (`writableBundle`). |
| `src/features/portals/logo.ts` | Multipart upload `/api/media` + link a `branding.logo`. Se portale non esiste, Media resta orfano. |
| `src/features/portals/route.ts` | Hono routes BFF, error responder uniforme. |
| `src/features/onboard-school/markdown-writer.ts` | `writePendingSchoolMarkdown` ora crea/update via gateway (nome storico mantenuto per minimo diff su `agent.ts`). |
| `src/core/payload/gateway.ts` | Esteso con supporto `where[field][op]=value` nei params di `list` per lookup esatto via slug. |
| `scripts/migrate-portals-md-to-payload.ts` | Migration one-shot idempotente per `.md` residui dev (`--dry-run`). |

## Tool agente toccati

Sono tutti in `src/features/onboard-school/agent.ts`. Le firme sono invariate;
cambia solo la sorgente di verita' a valle:

- `save_pending_school` → crea o aggiorna doc Payload
- `list_portals`, `get_portal`, `resolvePortal` → leggono Payload
- `update_portal`, `delete_portal`, `add_bundle_to_portal`, `update_catalog`,
  `update_bundle`, `remove_bundle` → PATCH/DELETE Payload via gateway
- `render_logo_uploader` → invariato lato agente; il file finisce su Media collection

## Gotcha critici

### Full-doc validation su PATCH

Payload PATCH su una collection con array `required` rivalida l'intero
documento dopo il merge. Sui `pending-schools` con `bundles` array required
puo' scattare `ValidationError` anche su update che non tocca `bundles`. Stesso
problema documentato su `products` (vedi `cms/CLAUDE.md`). Fallback noto:
raw SQL update (`cms/lib/studio/data/raw-write.ts`). Da verificare empiricamente
con uso live.

### Schema DB e provisioning

Lo schema canonico delle tabelle `pending_schools` + `pending_schools_bundles`
e' in `cms/db/schema.sql` (committato 2026-05-28 dopo `pg_dump` post-PAYLOAD_PUSH
su staging). Per ambienti nuovi/vuoti `scripts/apply-schema.sh` cms ricrea
tutto. Per ambienti gia' provisioned (es. produzione futura) servira' applicare
manualmente i DDL al primo deploy che porta la collection.

### Auth chain agente -> gateway

L'agente onboard-school scriveva su fs senza auth; ora passa per il gateway
Payload con `TENANT_KYRON_PAYLOAD_API_KEY` (service-to-service). Il cookie
`kyron-rev` non e' richiesto per le scritture agente. Nessun controllo
granular RBAC oggi — coerente con `data-editor` (feature 002).

### resolvePortal fuzzy match

Resta in-memory: fetch list completa + filter normalizzato su `slug` + `nome`.
Soglia di ok finche' i portali sono < ~500 — oltre va spostato a query
`where[nome][like]` Payload-side con post-filter normalizzato.

## Riferimenti

- `Kyron/documentation/decisions/decision-016-portals-storage-payload.md` — decisione cross-cutting
- `Kyron/documentation/decisions/decision-014-studio-bff-gateway.md` — strato gateway base
- `Kyron/documentation/workstreams/05-portals-storage-payload.md` — esecuzione, blocker, smoke test
- `studio/documentation/features/007-portals-module.md` — UI lato studio
- `cms/payload/collections/PendingSchools.ts` — schema sorgente
- `cms/db/schema.sql` — DDL tabelle `pending_schools` + `pending_schools_bundles` (commit `30043ec`)

## Test live (2026-05-28)

- `GET https://staging.kyronedu.it/api/pending-schools` -> 200 `{docs:[], totalDocs:0}`
- `GET https://studio-server.kyronedu.it/api/v1/portals` -> 200 `[]`
- Smoke UI end-to-end (creazione + edit inline + logo upload + delete) -> **todo** (Alek)
