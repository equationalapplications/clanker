-- Proactive character scheduler Phase 2: server-authoritative read state.
--
-- proactiveWakeupGuardrails gates pushes on unreadProactiveCount === 0 — a
-- "don't nag someone who hasn't read the last one" rule. The sweeper evaluates
-- that with no device in the loop, so read state must be visible to the server.
-- Client-only read state could render a badge but could never feed the guardrail.
--
-- Nullable and additive; existing rows are correctly NULL (unread). Forward-only
-- runner: rollback is a new migration dropping the column.
--
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-phase2-design.md

ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Partial index: the only query is "unread proactive messages for this
-- character", so indexing the read rows would be dead weight.
CREATE INDEX IF NOT EXISTS messages_character_unread_idx
  ON messages (character_id, created_at)
  WHERE read_at IS NULL;
