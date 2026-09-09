-- Proactive lifecycle-sync: per-user push-readiness capability (Decision 1).
--
-- The global PROACTIVE_PUSH_ENABLED gate is a blunt instrument: flipping it
-- fires pushes at every client that ever registered a token, including clients
-- that cannot sync, badge, or deeplink. This column records whether the device
-- that owns the CURRENT token (single-token per user, last device wins) is a
-- new client: registerExpoPushToken writes it explicitly in both directions
-- (true when capabilities.proactivePush === true, false otherwise), so readiness
-- arrives exactly when a capable client registers and a downgrade undoes it.
-- It gates only the notification — quiet messages persist and sync regardless.
--
-- Additive with a default; forward-only runner, rollback is a new migration.
-- Fleet-wide kill switch without a deploy: UPDATE users SET
-- proactive_push_ready = false.
--
-- Spec: docs/superpowers/specs/2026-09-09-proactive-lifecycle-sync-ungate-design.md

ALTER TABLE users ADD COLUMN IF NOT EXISTS proactive_push_ready boolean NOT NULL DEFAULT false;
