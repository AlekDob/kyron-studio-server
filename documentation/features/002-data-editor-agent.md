---
type: feature
project: kyron-studio-server
created: 2026-05-26
last_verified: 2026-05-26
tags: [agent, ai-sdk, sse, tools, workstream-02]
---

# 002 — Agente "Editor Dati"

## Cosa

Agente AI SDK v4 (`streamText` + tools) esposto via SSE che legge e modifica
le collection Payload usando il **gateway BFF feature 001** come unica fonte
di verita'. L'utente in Studio chatta con l'agente nella colonna destra di
`/dati/[slug]` e `/dati/[slug]/[id]` — entrambi (umano + AI) operano sugli
stessi endpoint.

## Stato

Phase 3 workstream 02 — done 2026-05-26. Live su
`POST /agents/data-editor` (SSE).

## Endpoint

```
POST /agents/data-editor
Headers: X-Tenant: kyron, Cookie: kyron-rev=...
Body: {
  messages: [{role: "user"|"assistant", content: string}],
  context?: { slug?: string, id?: string|number }
}
Response: text/event-stream
```

Eventi SSE:
- `data: {"delta": "..."}` — text token dal modello
- `data: {"tool": "name", "args": {...}}` — tool call iniziato
- `data: {"toolResult": "name", "ok": true}` — tool call completato
- `data: {"error": "..."}` — errore
- `data: [DONE]` — fine stream

## Tools

| Tool | Cosa fa | Editable check |
|---|---|---|
| `list_records` | Lista record (q, page, limit) | no (read tool) |
| `get_record` | Singolo record completo (locale=all) | no |
| `update_record` | PATCH parziale | si |
| `create_record` | Crea record | si |
| `delete_record` | Elimina record (con conferma utente nel system prompt) | si |

Tutti delegano a `makePayloadGateway(tenant)` — stesso client usato dalle route
CRUD.

## System prompt (sintesi)

`src/features/data-editor/prompt.ts`:
- Italiano, conciso, no preamboli
- Pattern read-before-write: get_record → propone modifica → conferma utente →
  update_record
- Niente ID inventati: usare list_records con `q`
- Markdown per field rich-text (titoli ###, liste, **grassetto**)
- Read-only collections: spiega che non puoi modificare invece di provarci
- Output liste come tabella markdown id+titolo+slug

## File chiave

| File | Ruolo |
|---|---|
| `src/features/data-editor/prompt.ts` | System prompt + regole |
| `src/features/data-editor/agent.ts` | `streamText` + 5 tool con Zod schema |
| `src/features/data-editor/route.ts` | Hono SSE handler (`tenant` + `studio-auth` middleware) |
| `src/index.ts` | Mount su `/agents/data-editor` |

## Gotcha — `maxSteps`

**AI SDK v4 default `maxSteps: 1`** → l'agente fa il primo tool call e si
ferma senza produrre testo finale. Bisogna passare `maxSteps: 8` (o simile)
in `streamText` per permettere la generazione della risposta dopo il tool
result.

Pattern: tutti gli agenti multi-step in studio-server devono settarlo
esplicitamente. Vale anche per future feature.

## Model resolution

Usa `resolveModel("data-editor", "default")` da
`features/settings/resolve-model.ts`. Se nessuna config in `processes` store →
fallback env `openai/gpt-4o` + API key dalla connection openai salvata in
settings (la stessa di `onboard-school`). Aggiungere card "data-editor" nel
pannello Modelli AI di Studio per override esplicito (oggi presente solo
per `onboard-school`).

## Test end-to-end verificati

```bash
curl -N -X POST -H "X-Tenant: kyron" -H "Cookie: kyron-rev=..." \
  -d '{"messages":[{"role":"user","content":"Quanti bandi ci sono?"}],
       "context":{"slug":"bandi"}}' \
  http://localhost:8790/agents/data-editor

→ data: {"tool":"list_records","args":{"slug":"bandi","limit":1}}
  data: {"toolResult":"list_records","ok":true}
  data: {"delta":"Ci"} ... data: {"delta":"23"} data: {"delta":" bandi."}
  data: [DONE]
```

## Vedi anche

- `studio-server` feature 001 (gateway BFF)
- `studio` feature 003 (modulo Dati + DataChat client)
- `Kyron/documentation/workstreams/02-studio-agentic-data-layer.md`
