-- Proactive character scheduler, Phase 1.
-- A character schedules its own future wake-up via the set_reminder tool; the
-- five-minute sweeper in functions/src/proactiveWakeupSweep.ts claims due rows
-- and hands them to cloud-agent. spent_amount is written back after the turn
-- and is the source for the per-character daily power ceiling — credit_spend_events
-- cannot serve that role because it has no character_id.
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md
CREATE TABLE IF NOT EXISTS scheduled_wakeups (
  id text PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  due_at timestamptz NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  run_key text NOT NULL,
  claimed_at timestamptz,
  resolved_at timestamptz,
  spent_amount integer NOT NULL DEFAULT 0,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_wakeups_status_check
    CHECK (status IN ('pending', 'claimed', 'done', 'skipped', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS scheduled_wakeups_status_due_idx
  ON scheduled_wakeups (status, due_at);

CREATE INDEX IF NOT EXISTS scheduled_wakeups_character_status_idx
  ON scheduled_wakeups (character_id, status);

CREATE INDEX IF NOT EXISTS scheduled_wakeups_resolved_at_idx
  ON scheduled_wakeups (resolved_at);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_wakeups_run_key_unique_idx
  ON scheduled_wakeups (run_key);
