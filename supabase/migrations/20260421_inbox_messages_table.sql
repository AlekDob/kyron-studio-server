-- Migration: create messages table
-- Feature: 002-inbox-module
-- Date: 2026-04-21
--
-- Purpose: normalized message storage (1-N with conversations).
-- Replaces the JSONB blob approach for inbox conversations.
-- Legacy conversations.messages column stays for backward compat.
--
-- Up:
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at);

-- Down (manual):
-- DROP TABLE IF EXISTS messages;
