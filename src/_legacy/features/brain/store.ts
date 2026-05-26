import { supabaseService } from "@/core/supabase/client.js";
import type { BrainDocument, SourceType } from "./types.js";
import {
  memCreateDocument,
  memListDocuments,
  memGetDocument,
  memDeleteDocument,
} from "./memory.store.js";

// Brain: 004-brain-module
// Brain: dev-mode-requires-memory-fallback

let warnedNoSupabase = false;
function warnOnce(): void {
  if (warnedNoSupabase) return;
  warnedNoSupabase = true;
  console.warn("[brain-store] Supabase not configured - using in-memory fallback");
}

function mapDocument(row: Record<string, unknown>): BrainDocument {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    title: String(row.title),
    sourceType: String(row.source_type) as SourceType,
    sourceMetadata: (row.source_metadata as Record<string, unknown>) ?? {},
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdByAgentId: row.created_by_agent_id ? String(row.created_by_agent_id) : null,
    isEphemeral: Boolean(row.is_ephemeral),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    createdAt: String(row.created_at),
  };
}

export async function createDocument(
  orgId: string,
  title: string,
  sourceType: SourceType,
  userId: string | null,
  agentId: string | null,
  isEphemeral = false,
): Promise<BrainDocument> {
  if (!supabaseService) {
    warnOnce();
    return await memCreateDocument(orgId, title, sourceType, userId, agentId, isEphemeral);
  }
  const ttl = isEphemeral ? 30 : null;
  const { data, error } = await supabaseService
    .from("brain_documents")
    .insert({
      org_id: orgId,
      title,
      source_type: sourceType,
      created_by_user_id: userId,
      created_by_agent_id: agentId,
      is_ephemeral: isEphemeral,
      expires_at: ttl
        ? new Date(Date.now() + ttl * 86400_000).toISOString()
        : null,
    })
    .select()
    .single();
  if (error) throw new Error(`createDocument: ${error.message}`);
  return mapDocument(data);
}

export async function listDocuments(
  orgId: string,
  sourceType?: SourceType,
  limit = 20,
): Promise<BrainDocument[]> {
  if (!supabaseService) {
    warnOnce();
    return await memListDocuments(orgId, sourceType, limit);
  }
  let query = supabaseService
    .from("brain_documents")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (sourceType) query = query.eq("source_type", sourceType);
  const { data, error } = await query;
  if (error) throw new Error(`listDocuments: ${error.message}`);
  return (data ?? []).map(mapDocument);
}

export async function getDocument(id: string): Promise<BrainDocument | null> {
  if (!supabaseService) return await memGetDocument(id);
  const { data, error } = await supabaseService
    .from("brain_documents")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data ? mapDocument(data) : null;
}

export async function deleteDocument(id: string): Promise<boolean> {
  if (!supabaseService) return await memDeleteDocument(id);
  const { error } = await supabaseService
    .from("brain_documents")
    .delete()
    .eq("id", id);
  return !error;
}
