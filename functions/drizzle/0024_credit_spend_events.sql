-- Append-only attribution ledger for credit spends (issue #375).
-- Nothing that computes balances reads this table — credit_transactions stays
-- the source of truth, so existing queries are untouched. reason is free-form
-- text; the token registry lives in the spec under
-- docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md.
CREATE TABLE IF NOT EXISTS credit_spend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credit_spend_events_user_created_idx
  ON credit_spend_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS credit_spend_events_reason_idx ON credit_spend_events (reason);
