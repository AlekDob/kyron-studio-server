/**
 * Supabase MCP store — placeholder strutturato.
 *
 * Schema tabella suggerito (da creare quando si attiva il supabase store):
 *
 *   create table mcp_servers (
 *     id uuid primary key default gen_random_uuid(),
 *     org_id text not null,
 *     name text not null,
 *     description text,
 *     type text not null check (type in ('stdio','http','sse')),
 *     command text,
 *     args jsonb not null default '[]'::jsonb,
 *     url text,
 *     env jsonb not null default '{}'::jsonb,
 *     enabled boolean not null default true,
 *     read_only boolean not null default true,
 *     assigned_agents jsonb not null default '[]'::jsonb,
 *     last_verified_at timestamptz,
 *     last_error text,
 *     created_at timestamptz not null default now(),
 *     updated_at timestamptz not null default now(),
 *     unique (org_id, name)
 *   );
 *
 * Per ora l'implementazione reale non e' prioritaria: l'installazione
 * on-premise tipica usa file store (gitignored, montato come volume docker).
 * Il cloud multi-tenant rientra in fase 2.
 */

import type { McpStore } from "./interface.js";

export function createSupabaseStore(): McpStore {
  throw new Error(
    "Supabase MCP store non ancora implementato — usa SPACESHIP_STORE=file (default) o memory",
  );
}
