import { supabaseService } from "./client.js";
import type { ChatMessage } from "@/core/agent-runtime/index.js";

// Brain: 002-data-layer — memoria conversazioni su Postgres relazionale
// Tabella `conversations` e `messages` da creare via migrazione (fuori scope M1).

export interface ConversationRecord {
  userId: string;
  messages: ChatMessage[];
  assistantReply: string;
  // Brain: 001-preflight-refactor
  // Required for Inbox multi-agent dispatch (feature 002). Column added via
  // supabase/migrations/20260420_add_agent_id_to_conversations.sql.
  agentId: string | null;
}

export async function persistConversation(
  record: ConversationRecord,
): Promise<void> {
  if (!supabaseService) {
    // Soft-fail in dev without Supabase configured
    return;
  }
  try {
    await supabaseService.from("conversations").insert({
      user_id: record.userId,
      messages: record.messages,
      assistant_reply: record.assistantReply,
      agent_id: record.agentId,
    });
  } catch (err) {
    console.warn("[conversations] persist failed:", err);
  }
}
