-- Inflate all credit units by 100 (user-facing unit becomes "Power").
-- Historical conversion factor CREDIT_SCALE = 100. Guarded to run exactly once.
CREATE TABLE IF NOT EXISTS migration_0020_credit_power_scale_applied (
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migration_0020_credit_power_scale_applied) THEN
    UPDATE credit_transactions
    SET initial_amount = initial_amount * 100,
        remaining_balance = remaining_balance * 100,
        delta = delta * 100;

    UPDATE subscriptions
    SET current_credits = current_credits * 100;

    INSERT INTO migration_0020_credit_power_scale_applied DEFAULT VALUES;
  END IF;
END $$;
