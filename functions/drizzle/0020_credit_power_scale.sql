-- Inflate all credit units by 100 (user-facing unit becomes "Power").
-- Historical conversion factor CREDIT_SCALE = 100. Run exactly once.
UPDATE credit_transactions
SET initial_amount = initial_amount * 100,
    remaining_balance = remaining_balance * 100,
    delta = delta * 100;

UPDATE subscriptions
SET current_credits = current_credits * 100;
