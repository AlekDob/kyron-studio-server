---
type: feature
project: kyron-studio-server
created: 2026-05-26
last_verified: 2026-05-26
tags: [agent, ai-sdk, review, workstream-03]
---

# 003 — Agente Review Editor

## Cosa

SSE endpoint `/agents/review-editor` (X-Tenant + studio-auth) per il modulo
"Anteprima" di studio.kyronedu.it. Aiuta l'utente a costruire un bundle
di annotazioni mentre naviga il sito in un iframe.

## Tool esposti

| Tool | Effetto | Quando |
|---|---|---|
| `propose_annotation` | preview strutturata (no side effect) | prima conferma |
| `add_annotation` | il client aggiunge al bundle | dopo conferma utente |
| `request_send_bundle` | chiede al client di inviare | bundle pronto |

## Stateless by design

L'agente NON tiene stato. Le annotazioni vivono in React state lato
studio (`PreviewWorkspace`). I tool ritornano semplicemente payload
formattati che il client interpreta. Conseguenze:
- nessun DB lato studio-server
- nessuna ambiguita' tra "agent state" e "user state"
- il client e' single source of truth

## File chiave

| File | Ruolo |
|---|---|
| `src/features/review-editor/prompt.ts` | system prompt italiano + regole |
| `src/features/review-editor/agent.ts` | `streamText` + tool definitions (Zod) |
| `src/features/review-editor/route.ts` | Hono SSE handler (X-Tenant + studioAuth) |
| `src/index.ts` | mount `/agents/review-editor` |

## Gotcha riusati da feature 002

- `maxSteps: 8` obbligatorio (default v4 e' 1, vedi feature 002)
- `resolveModel("review-editor", "default")` — fallback su provider/model
  configurati nel settings store

## Flusso

```
studio /preview
  ├─ PreviewChat → POST /api/agent/review-editor (proxy)
  └─ studio /api/agent/review-editor → POST /agents/review-editor (this)
       └─ runReviewEditorAgent({messages, context})
            └─ streamText con 3 tool
            └─ yields full stream parts (text-delta, tool-call, tool-result)
       └─ Hono streamSSE → events delta/tool/toolResult/error/[DONE]
  └─ Client interpreta tool-call 'add_annotation' → React setState
```

## Context passato dall'utente

```ts
context: {
  currentUrl?: string;     // URL iframe corrente
  currentPath?: string;    // pathname
  annotationsCount?: number;  // quante annotazioni nel bundle
}
```

L'agente lo riceve nel system prompt preamble per riferimenti pertinenti.

## Vedi anche

- `Kyron/documentation/workstreams/03-studio-standalone.md`
- studio feature 005-preview-review-editor
- studio-server feature 002 (data-editor) — stesso pattern AI SDK + Hono SSE
