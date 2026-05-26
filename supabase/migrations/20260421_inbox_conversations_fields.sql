-- Migration: add inbox fields to conversations
-- Feature: 002-inbox-module
-- Date: 2026-04-21
--
-- Purpose: conversations need title, last_message_at and unread_count
-- for the Inbox list view. Backward compatible: all columns have defaults.
--
-- Up:
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'Nuova conversazione',
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS unread_count INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_user_last_msg
  ON conversations (user_id, last_message_at DESC);

-- Down (manual):
-- DROP INDEX IF EXISTS idx_conversations_user_last_msg;
-- ALTER TABLE conversations
--   DROP COLUMN title,
--   DROP COLUMN last_message_at,
--   DROP COLUMN unread_count;
