-- 0020_credit_power_scale.sql inflated existing credit_transactions/subscriptions rows x100
-- but never touched handle_new_user(), which independently hardcodes the signup grant.
-- Result: new signups still got 50 Power instead of 5,000 (app-code addCredits(5000) is
-- skipped because the trigger's credit_transactions row already exists by the time
-- subscriptionService.getOrCreateDefaultSubscription checks hasAnyCreditRow).

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO subscriptions (
    user_id,
    plan_tier,
    plan_status,
    current_credits,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    'free',
    'active',
    5000,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Idempotency is delegated to credit_transactions_idempotency_idx, the partial unique
  -- index on (user_id, reason, reference_id) WHERE reference_id IS NOT NULL. A NOT EXISTS
  -- guard on a narrower or wider key than the index would let a row through that then
  -- fails the unique constraint, so match the index exactly via ON CONFLICT.
  INSERT INTO credit_transactions (
    user_id,
    delta,
    reason,
    reference_id,
    initial_amount,
    remaining_balance,
    transaction_type,
    expires_at,
    created_at
  ) VALUES (
    NEW.id,
    5000,
    'signup',
    'signup',
    5000,
    5000,
    'signup',
    NULL,
    NOW()
  )
  ON CONFLICT (user_id, reason, reference_id) WHERE reference_id IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

DROP TRIGGER IF EXISTS handle_new_user ON users;
CREATE TRIGGER handle_new_user
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();
