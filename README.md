# Spaceship Server

Node.js + Hono + Mastra. Server-side agent orchestration for the Spaceship desktop client.

## Prerequisites

- Node 18+
- Anthropic or OpenAI API key
- (Optional) Supabase project for auth + conversation memory

## Setup

```bash
npm install
cp .env.example .env
# Fill ANTHROPIC_API_KEY at minimum
```

## Run

```bash
npm run dev          # tsx watch
# or
npm run build && npm start
```

Listens on `http://localhost:8787` by default. Health: `GET /health`.

## Architecture

- `src/core/agent-runtime/` — Framework-agnostic `AgentRuntime` interface + Mastra adapter. **No `@mastra/*` import outside `mastra.adapter.ts`** (ADR-003).
- `src/core/supabase/` — Auth (anon JWT verify) + Postgres conversation memory. **No pgvector** (ADR-002).
- `src/core/auth/` — Hono middleware enforcing Supabase JWT on protected routes.
- `src/features/chat/` — `POST /chat` with SSE streaming compatible with assistant-ui custom runtime.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/health` | Liveness probe |
| POST | `/chat`   | SSE chat stream (auth required) |

### `POST /chat` — request body

```json
{
  "agentId": "hello-world",
  "messages": [
    { "role": "user", "content": "ciao" }
  ]
}
```

### `POST /chat` — SSE event stream

```
data: {"delta":"Ciao"}

data: {"delta":"! Come"}

data: {"delta":" posso aiutarti?"}

data: [DONE]
```

## Non-Goals (M1)

No embeddings, no vector store, no RAG, no MCP, no HITL. See parent repo `documentation/specs/m1-scaffold.md`.
