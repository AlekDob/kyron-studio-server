import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Brain: 002-data-layer — Postgres-only, no pgvector/RAG
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

function optionalClient(key: string | undefined): SupabaseClient | null {
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const supabaseService = optionalClient(serviceKey);
export const supabaseAnon = optionalClient(anonKey);

export const isSupabaseConfigured =
  Boolean(url && (serviceKey || anonKey));
