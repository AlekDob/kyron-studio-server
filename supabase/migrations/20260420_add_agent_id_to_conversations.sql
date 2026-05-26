-- Migration: add agent_id to conversations
-- Feature: 001-preflight-refactor
-- Date: 2026-04-20
--
-- Purpose: track which agent replied to a conversation. Required for Inbox
-- multi-agent dispatch (feature 002). Backward compatible: nullable column,
-- no default, existing rows stay NULL.
--
-- Up:
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_id TEXT NULL;

COMMENT ON COLUMN conversations.agent_id IS
  'Agent that produced the assistant_reply. NULL for legacy rows (pre-Inbox).';

-- Down (manual):
-- ALTER TABLE conversations DROP COLUMN agent_id;
