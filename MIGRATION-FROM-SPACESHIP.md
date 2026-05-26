# Migration from spaceship-server → studio-server

Questo repo e' un clone di `/Personal/spaceship-server` (decision-013 in Kyron). Lo scopo e' essere il **backend agentico orizzontale di Studio Futuro**, tenant-aware via header `X-Tenant`. Il clone parte con surface area spaceship completa per non rallentare il bootstrap. La pulizia avviene in due fasi.

## Fase 1 — Day 1 (oggi, 2026-05-26): boot studio-server

- [x] Rename package.json (`spaceship-server` → `studio-server`)
- [x] Rename health endpoint payload + boot log
- [x] Fresh `git init` (no fork history)
- [ ] Skeleton `src/features/onboard-school/` (route + agent + tools)
- [ ] Skeleton `src/core/tenant/` (middleware X-Tenant + config per tenant)
- [ ] Skeleton `src/core/payload/` (REST client a kyronedu.it/api)

## Fase 2 — Day 4 (2026-05-26) — cleanup eseguito

Moduli spaceship-specifici spostati in `src/_legacy/`:

- [x] `src/features/accounting/` → `_legacy/features/accounting/`
- [x] `src/features/bi/` → `_legacy/features/bi/`
- [x] `src/features/brain/` → `_legacy/features/brain/`
- [x] `src/features/chat/` → `_legacy/features/chat/`
- [x] `src/features/clients/` → `_legacy/features/clients/`
- [x] `src/features/inbox/` → `_legacy/features/inbox/`
- [x] `src/features/org/` → `_legacy/features/org/`
- [x] `src/features/settings/` → `_legacy/features/settings/`
- [x] `src/features/workflow/` → `_legacy/features/workflow/`
- [x] `src/core/mcp/` → `_legacy/core/mcp/`
- [x] `src/core/supabase/` → `_legacy/core/supabase/`
- [x] `src/core/vector-store/` → `_legacy/core/vector-store/`
- [x] `src/core/embeddings/` → `_legacy/core/embeddings/`
- [x] `src/core/approvals/` → `_legacy/core/approvals/`
- [x] `src/core/events/` → `_legacy/core/events/`
- [x] `src/index.ts` riscritto minimale: solo CORS + logger + `/health` + `/agents/onboard-school`

In src/ rimangono solo i moduli rilevanti per Studio:

- `core/agent-runtime/` — registry agent generico
- `core/auth/` — driver auth (Supabase driver in `_legacy/`, da sostituire con Payload-cookie driver Day 5)
- `core/db/` — Drizzle setup (utile per persistenza tenant-config + agent-runs log)
- `core/llm/` — AI SDK provider abstraction
- `core/payload/` — client REST verso Payload Kyron
- `core/storage/` — local-fs / supabase storage adapter
- `core/tenant/` — middleware X-Tenant + config registry
- `core/types/`
- `features/onboard-school/`
- `config/tenants/`

Cosa resta in `_legacy/`: ~30 file referenziati nel vecchio `index.ts`. Eliminazione fisica in un secondo passaggio quando avremo testato il boot pulito + nessuna regressione.

## Cleanup dependencies (pendente)

`package.json` ha ancora dipendenze spaceship-only orfane dopo il cleanup. Da rimuovere in Day 5 pre-deploy:

- [ ] `@mastra/core` (era usato in accounting/brain)
- [ ] `@modelcontextprotocol/sdk` (mcp pool)
- [ ] `@supabase/supabase-js` (auth driver)
- [ ] `mammoth` + `pdf-parse` (parser per moduli legacy)
- [ ] `node-cron` (scheduler workflow)
- [ ] `ollama-ai-provider` (se non serve fallback locale)
- [ ] `@types/node-cron`, `@types/pdf-parse`

Da mantenere: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `hono`, `@hono/node-server`, `@hono/zod-validator`, `drizzle-orm`, `drizzle-kit`, `postgres`, `dotenv`, `zod`, `tsx`, `typescript`.

## Configurazione minima per Kyron tenant

## Configurazione minima per Kyron tenant

`.env`:
```
PORT=8787
NODE_ENV=development
AUTH_DRIVER=payload          # nuovo driver (Fase 2)
PAYLOAD_API_URL=https://kyronedu.it/api
TENANT_KYRON_PAYLOAD_API_URL=https://kyronedu.it/api
OPENAI_API_KEY=...
CORS_ORIGIN=http://localhost:3001,https://studio.kyronedu.it
```

`src/config/tenants/kyron.ts` (Fase 2):
```ts
export const kyronTenant = {
  slug: "kyron",
  payloadApiUrl: process.env.TENANT_KYRON_PAYLOAD_API_URL!,
  agents: ["onboard-school"],
  // schema PendingSchools matcha frontmatter di kyron-ecommerce/documentation/schools/_TEMPLATE.md
};
```

## Decisioni di riferimento

- `kyron/documentation/decisions/decision-012-studio-admin-hub.md`
- `kyron/documentation/decisions/decision-013-studio-server-as-horizontal-product.md`
