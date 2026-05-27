---
type: feature
project: kyron-studio-server
created: 2026-05-26
last_verified: 2026-05-27
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
  pendingTarget?: {        // Phase 5: elemento selezionato nell'iframe
    urn: string | null;
    nodeKind: "text" | "image" | "section" | "page" | "gap";
    page: string;
    currentText?: string;
    assetSrc?: string;
    selector?: string;
  };
}
```

L'agente lo riceve nel system prompt preamble. Quando `pendingTarget`
e' presente lo formatta come `ELEMENTO SELEZIONATO` e prende
page/selector/original.text da li' senza re-interrogare l'utente.

### Phase 6 — sectionContext (2026-05-27)

Il campo `sectionContext` (opzionale) viene aggiunto a `pendingTarget`:

```ts
sectionContext?: {
  outline: string;   // DOM outline tree (tag+classi, depth 3)
  images: Array<{ src: string; alt?: string }>;
}
```

Quando presente, `formatSectionContext()` in `agent.ts` lo formatta
come preamble aggiuntivo nel system prompt:
- **Struttura DOM**: albero indentato tag+classi della sezione parent
- **Immagini**: lista `src` + `alt` di tutte le `<img>` nella sezione

Questo da' all'agente visibilita' sulla struttura della pagina attorno
all'elemento selezionato, migliorando le proposte `restructure` e
`replace-image`.

## Phase 5b — capability estese (2026-05-26)

Il prompt e' stato esteso per spingere l'agente a proporre attivamente:

- `replace-image` con `proposal.newAssetHint` libero (mood + soggetto + stile)
- `restructure` con `proposal.note` in italiano libero (es. "passa da
  3 a 5 colonne", "masonry asimmetrica", "foto hero a tutta larghezza")
- `add-section` per blocchi nuovi (testimonial, gallery, stat, FAQ, CTA)
- Suggerimenti a 2-3 alternative concrete quando l'utente e' vago

Niente DSL per il layout — la `proposal.note` finisce nel .md inviato
ad Alek che lo legge e interpreta.

## Vedi anche

- `Kyron/documentation/workstreams/03-studio-standalone.md`
- studio feature 005-preview-review-editor
- studio-server feature 002 (data-editor) — stesso pattern AI SDK + Hono SSE
