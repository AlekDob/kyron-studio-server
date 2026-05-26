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
/settings                         → AI provider config + model routing
/api/v1/collections               → BFF gateway Payload (X-Tenant + kyron-rev cookie) — feature 001
/api/v1/collections/:slug         → list records
/api/v1/collections/:slug/:id     → get/update/delete record
```

## Auth

- **Agent routes** (`/agents/*`): `X-Tenant` header + cookie forwarding (user's `payload-token`)
- **Gateway routes** (`/api/v1/*`): `X-Tenant` header + `kyron-rev` cookie HMAC validation + Payload API Key service-to-service
- **Settings routes** (`/settings`): no auth (TODO: proteggere)

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

## Knowledge base

- `documentation/features/001-bff-gateway.md` — gateway Payload REST normalizzato
- `documentation/features/002-data-editor-agent.md` — agente AI multi-tool
- `documentation/features/003-review-editor-agent.md` — agente AI Review Editor (workstream 03)
- Decision-014: `Kyron/documentation/decisions/decision-014-studio-bff-gateway.md`
- Workstream 02: `Kyron/documentation/workstreams/02-studio-agentic-data-layer.md`
- Workstream 03: `Kyron/documentation/workstreams/03-studio-standalone.md`
- Origine: migrato da `spaceship-server` (2026-05-26, vedi `MIGRATION-FROM-SPACESHIP.md`)

## Gotcha critici

- **AI SDK v4 `maxSteps: 1` di default**: l'agente fa il primo tool call e si ferma SENZA produrre testo finale. Sempre passare `maxSteps: 8` (o simile) in `streamText` per multi-step. Vedi feature 002.
- **Payload search field per-collection**: `where[titolo][contains]` fallisce 400 su `products` (campo si chiama `name`). Map in `src/core/payload/gateway.ts:SEARCH_FIELDS`.
- **API Key Payload bypassa access control**: oggi no granularita' editor RBAC. Da rivedere quando ci saranno ruoli diversi.

## File chiave

| File | Ruolo |
|---|---|
| `src/index.ts` | entry point, Hono app, route mounting |
| `src/middleware/studio-auth.ts` | validazione cookie kyron-rev HMAC |
| `src/core/tenant/middleware.ts` | validazione X-Tenant header |
| `src/core/payload/gateway.ts` | client HTTP generico verso Payload REST |
| `src/core/payload/client.ts` | client legacy per PendingSchools (cookie-based) |
| `src/features/collections/route.ts` | CRUD route handler gateway |
| `src/features/collections/registry.ts` | metadata collection (slug, label, purpose) |
| `src/features/onboard-school/` | agente onboarding scuole |
| `src/features/data-editor/` | agente Editor Dati (Phase 3 workstream 02) |
| `src/features/settings/` | settings store + model routing |
| `src/config/tenants/kyron.ts` | config tenant Kyron |
