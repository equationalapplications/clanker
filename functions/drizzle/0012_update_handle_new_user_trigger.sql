-- Update the handle_new_user trigger so new signups seed both the subscription cache
-- and the authoritative signup credit transaction row.

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
    50,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM credit_transactions
    WHERE user_id = NEW.id
      AND reason = 'signup'
      AND reference_id = 'signup'
      AND initial_amount = 50
      AND remaining_balance = 50
      AND transaction_type = 'signup'
      AND expires_at IS NULL
  ) THEN
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
      50,
      'signup',
      'signup',
      50,
      50,
      'signup',
      NULL,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

DROP TRIGGER IF EXISTS handle_new_user ON users;
CREATE TRIGGER handle_new_user
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();
