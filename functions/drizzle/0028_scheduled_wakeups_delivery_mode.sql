-- Proactive character scheduler Phase 2: promote the delivery mode out of the
-- free-text outcome string into real columns.
--
-- todaysPushCount was derived by matching outcome LIKE 'mode=notify%'. In Phase 1
-- that count gated nothing visible, so a miss was harmless. In Phase 2 it gates
-- real push notifications, where a miss either over-notifies past the daily cap
-- or silently suppresses a message.
--
-- TWO columns, not one. proactiveWakeupHandler writes
-- 'mode=<effective> chosen=<model choice>', and resolveDeliveryMode clamps a
-- chosen 'notify' down to 'quiet' when notifyAllowed is false. 'chosen' is the
-- Phase 1 deliverable — the distribution the rollout gate tunes the caps
-- against — so collapsing both into one column would discard it permanently.
--
-- Every UPDATE carries an IS NULL guard so this file is safely re-runnable: a
-- re-run after Phase 2 rows exist can never overwrite a correctly written value
-- with one re-parsed from free text.
--
-- Forward-only: scripts/migrate.mjs has no DOWN support. Rolling back means a
-- new forward migration that drops these columns. outcome is left intact, so
-- the columns can be dropped and recomputed with no data loss.
--
-- Spec: docs/superpowers/specs/2026-09-08-proactive-character-scheduler-phase2-design.md

ALTER TABLE scheduled_wakeups ADD COLUMN IF NOT EXISTS delivery_mode text;
ALTER TABLE scheduled_wakeups ADD COLUMN IF NOT EXISTS chosen_delivery_mode text;

-- Effective mode, after the notifyAllowed clamp. Prefix match, mirroring the
-- LIKE 'mode=notify%' predicate it replaces.
UPDATE scheduled_wakeups SET delivery_mode = 'notify'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=notify %';
UPDATE scheduled_wakeups SET delivery_mode = 'quiet'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=quiet %';
UPDATE scheduled_wakeups SET delivery_mode = 'silent'
  WHERE delivery_mode IS NULL AND outcome LIKE 'mode=silent %';

-- What the model chose before the clamp — the Phase 1 observational signal.
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'notify'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=notify';
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'quiet'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=quiet';
UPDATE scheduled_wakeups SET chosen_delivery_mode = 'silent'
  WHERE chosen_delivery_mode IS NULL AND outcome LIKE '% chosen=silent';

-- Rows whose outcome is not a 'mode=' string at all — stale_claim, turn_failed,
-- insufficient_power, identifier_mismatch, spend_failed, character_missing, and
-- every skip reason — correctly keep NULL in both columns.
--
-- Both stay bare nullable text with no CHECK constraint, so a future mode value
-- cannot fail a write in production.

CREATE INDEX IF NOT EXISTS scheduled_wakeups_character_delivery_idx
  ON scheduled_wakeups (character_id, delivery_mode, resolved_at);
