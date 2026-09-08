-- Proactive character scheduler: add the 'running' status.
--
-- claimRunKey previously wrote 'claimed' back over 'claimed', which made the
-- claim UPDATE re-enterable: a re-POST of a run_key whose first attempt died
-- before resolving matched the predicate a second time, returned 'reserved',
-- and spent AGENT_TURN_CREDIT_COST again. 'running' is the status the endpoint
-- moves a row into once it owns it, and it matches no claim predicate, so the
-- second POST gets 'duplicate' instead of a second charge.
--
-- 'claimed' keeps its meaning: the sweeper owns the row and has not yet had a
-- successful POST. 'running' means cloud-agent owns it and is mid-turn.
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-design.md
ALTER TABLE scheduled_wakeups
  DROP CONSTRAINT IF EXISTS scheduled_wakeups_status_check;

ALTER TABLE scheduled_wakeups
  ADD CONSTRAINT scheduled_wakeups_status_check
    CHECK (status IN ('pending', 'claimed', 'running', 'done', 'skipped', 'cancelled'));

-- Stale-claim reaper support. Rows stuck in 'claimed'/'running' have a NULL
-- resolved_at, so the retention delete (which filters on resolved_at) could
-- never match them and they leaked permanently. The sweeper now reaps them by
-- claimed_at, which this index serves.
CREATE INDEX IF NOT EXISTS scheduled_wakeups_claimed_at_idx
  ON scheduled_wakeups (claimed_at)
  WHERE resolved_at IS NULL;
