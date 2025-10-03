# Payment System Troubleshooting Guide

Quick reference for diagnosing and fixing common payment system issues.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Credit Issues](#credit-issues)
3. [Subscription Problems](#subscription-problems)
4. [Transaction Failures](#transaction-failures)
5. [Webhook Issues](#webhook-issues)
6. [Authentication Errors](#authentication-errors)
7. [Database Issues](#database-issues)
8. [Stripe Integration](#stripe-integration)

## Quick Diagnostics

### Health Check Queries

Run these SQL queries to quickly assess system health:

```sql
-- Check recent transaction activity
SELECT 
  DATE(created_at) as date,
  COUNT(*) as transactions,
  SUM(amount_cents) as total_amount,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM user_transactions 
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Check webhook processing
SELECT 
  event_source,
  processing_status,
  COUNT(*) as count,
  MAX(processed_at) as last_processed
FROM transaction_events 
WHERE processed_at >= NOW() - INTERVAL '24 hours'
GROUP BY event_source, processing_status;

-- Check user credits distribution
SELECT 
  plan_tier,
  COUNT(*) as users,
  AVG(credits_remaining) as avg_credits,
  MIN(credits_remaining) as min_credits,
  MAX(credits_remaining) as max_credits
FROM user_app_subscriptions 
WHERE app_name = 'yours-brightly' 
  AND plan_status = 'active'
GROUP BY plan_tier;
```

### Log Checking

Check Cloud Function logs for errors:

```bash
# View recent function logs
firebase functions:log --only exchangeToken --lines 50

# View Stripe webhook logs
firebase functions:log --only stripeWebhook --lines 50

# View transaction manager logs
firebase functions:log --only transactionManager --lines 50

# Filter for errors only
firebase functions:log --only stripeWebhook --lines 100 | grep ERROR
```

## Credit Issues

### Problem: Credits Not Updating After Purchase

**Symptoms**:
- User completes payment successfully
- Stripe shows payment as completed
- User's credit balance unchanged

**Diagnosis**:
```sql
-- Check if transaction was created
SELECT * FROM user_transactions 
WHERE external_transaction_id = 'pi_stripe_payment_intent_id';

-- Check if webhook event was processed
SELECT * FROM transaction_events 
WHERE raw_event_data->>'id' = 'evt_stripe_event_id';

-- Check user's current subscription
SELECT * FROM user_app_subscriptions 
WHERE user_id = 'user-uuid' AND app_name = 'yours-brightly';
```

**Solutions**:

1. **Webhook not delivered**:
   ```bash
   # Check Stripe webhook logs
   stripe logs tail --filter-account=acct_your_account
   ```

2. **User ID mismatch**:
   ```sql
   -- Find user by email instead
   SELECT id FROM auth.users WHERE email = 'user@example.com';
   ```

3. **Manual credit addition**:
   ```sql
   -- Add credits manually (emergency fix)
   UPDATE user_app_subscriptions 
   SET credits_remaining = credits_remaining + 100,
       updated_at = NOW()
   WHERE user_id = 'user-uuid' 
     AND app_name = 'yours-brightly';
   ```

### Problem: Unlimited Plan Not Working

**Symptoms**:
- User has unlimited subscription
- Still shows limited credits
- Credit deduction fails

**Diagnosis**:
```sql
-- Check plan tier
SELECT plan_tier, credits_remaining, plan_status 
FROM user_app_subscriptions 
WHERE user_id = 'user-uuid' AND app_name = 'yours-brightly';
```

**Solutions**:

1. **Fix plan tier**:
   ```sql
   UPDATE user_app_subscriptions 
   SET plan_tier = 'unlimited',
       credits_remaining = 999999
   WHERE user_id = 'user-uuid' 
     AND app_name = 'yours-brightly';
   ```

2. **Check Remote Config mappings**:
   ```javascript
   // Firebase Console → Remote Config → PRICE_ID_TO_TIER
   {
     "price_stripe_unlimited": "unlimited"  // Ensure this mapping exists
   }
   ```

### Problem: Credits Deducting Incorrectly

**Symptoms**:
- Wrong amount deducted
- Credits going negative
- Deduction not happening

**Check deduction function**:
```sql
-- Test credit deduction
SELECT deduct_user_credits('user-uuid', 'yours-brightly', 1);

-- Check function definition
\df deduct_user_credits
```

**Fix deduction logic**:
```sql
-- Recreate function if needed
CREATE OR REPLACE FUNCTION deduct_user_credits(
  p_user_id UUID,
  p_app_name TEXT,
  p_credit_amount INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  current_credits INTEGER;
  is_unlimited BOOLEAN;
BEGIN
  -- Get current credits and check if unlimited
  SELECT 
    credits_remaining, 
    (plan_tier = 'unlimited') INTO current_credits, is_unlimited
  FROM user_app_subscriptions 
  WHERE user_id = p_user_id 
    AND app_name = p_app_name 
    AND plan_status = 'active';
  
  -- If unlimited plan, don't deduct
  IF is_unlimited THEN
    RETURN TRUE;
  END IF;
  
  -- Check if enough credits
  IF current_credits < p_credit_amount THEN
    RETURN FALSE;
  END IF;
  
  -- Deduct credits
  UPDATE user_app_subscriptions 
  SET credits_remaining = credits_remaining - p_credit_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id 
    AND app_name = p_app_name;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

## Subscription Problems

### Problem: Subscription Not Activating

**Symptoms**:
- User completes Stripe checkout
- No subscription record in database
- User still on free plan

**Diagnosis**:
```sql
-- Check for subscription events
SELECT * FROM transaction_events 
WHERE event_type LIKE '%subscription%' 
  AND processed_at >= NOW() - INTERVAL '1 hour'
ORDER BY processed_at DESC;

-- Check Stripe webhook delivery
```

**Solutions**:

1. **Manual subscription creation**:
   ```sql
   INSERT INTO user_app_subscriptions (
     user_id, app_name, plan_tier, plan_status,
     credits_remaining, billing_provider_id,
     plan_start_at, plan_renewal_at, billing_metadata
   ) VALUES (
     'user-uuid', 'yours-brightly', 'unlimited', 'active',
     999999, 'sub_stripe_subscription_id',
     NOW(), NOW() + INTERVAL '1 month',
     '{"stripe_customer_id": "cus_customer_id"}'::jsonb
   );
   ```

2. **Resend webhook**:
   ```bash
   # In Stripe Dashboard → Webhooks → Click endpoint → Find event → Resend
   ```

### Problem: Subscription Cancellation Not Working

**Symptoms**:
- User cancels in Stripe
- Subscription still shows as active
- Credits still unlimited

**Check cancellation status**:
```sql
-- Check subscription status
SELECT plan_status, billing_metadata 
FROM user_app_subscriptions 
WHERE billing_provider_id = 'sub_stripe_subscription_id';
```

**Manual cancellation**:
```sql
UPDATE user_app_subscriptions 
SET plan_status = 'cancelled',
    updated_at = NOW()
WHERE billing_provider_id = 'sub_stripe_subscription_id';
```

## Transaction Failures

### Problem: Transactions Stuck in Pending

**Symptoms**:
- Transactions created but never completed
- Status remains "pending"

**Find pending transactions**:
```sql
SELECT transaction_id, external_transaction_id, created_at
FROM user_transactions 
WHERE status = 'pending' 
  AND created_at < NOW() - INTERVAL '1 hour';
```

**Update status manually**:
```sql
-- Check Stripe payment status first, then update
UPDATE user_transactions 
SET status = 'completed', updated_at = NOW()
WHERE transaction_id = 'txn_transaction_id';
```

### Problem: Duplicate Transactions

**Symptoms**:
- Multiple transaction records for single payment
- Credits added multiple times

**Find duplicates**:
```sql
SELECT external_transaction_id, COUNT(*) 
FROM user_transactions 
GROUP BY external_transaction_id 
HAVING COUNT(*) > 1;
```

**Remove duplicates** (keep latest):
```sql
WITH duplicates AS (
  SELECT id, 
    ROW_NUMBER() OVER (
      PARTITION BY external_transaction_id 
      ORDER BY created_at DESC
    ) as rn
  FROM user_transactions 
  WHERE external_transaction_id IN (
    SELECT external_transaction_id 
    FROM user_transactions 
    GROUP BY external_transaction_id 
    HAVING COUNT(*) > 1
  )
)
DELETE FROM user_transactions 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);
```

## Webhook Issues

### Problem: Webhooks Not Being Received

**Symptoms**:
- Stripe events show as delivered
- No transaction events in database
- Payments succeed but no credit updates

**Check webhook endpoint**:
```bash
# Test endpoint manually
curl -X POST https://stripewebhook-[hash]-uc.a.run.app \
  -H "Content-Type: application/json" \
  -d '{"test": "webhook"}'
```

**Check Stripe webhook settings**:
1. Go to Stripe Dashboard → Webhooks
2. Verify endpoint URL is correct
3. Check event types are selected
4. Verify webhook is enabled

**Check webhook secret**:
```bash
# In Cloud Functions environment
echo $STRIPE_WEBHOOK_SECRET
```

### Problem: Webhook Signature Verification Failing

**Symptoms**:
- Webhooks received but rejected
- "Invalid signature" errors in logs

**Solutions**:

1. **Update webhook secret**:
   ```bash
   # In functions directory
   firebase functions:config:set stripe.webhook_secret="whsec_new_secret"
   firebase deploy --only functions
   ```

2. **Check endpoint configuration**:
   - Ensure using raw body, not parsed JSON
   - Verify timestamp tolerance (default: 300 seconds)

### Problem: Webhook Processing Failures

**Symptoms**:
- Webhooks received successfully
- Processing fails with errors

**Check processing errors**:
```sql
SELECT event_type, error_message, raw_event_data 
FROM transaction_events 
WHERE processing_status = 'failed' 
ORDER BY processed_at DESC;
```

**Common fixes**:

1. **User not found**:
   ```sql
   -- Check if user exists in Supabase
   SELECT id FROM auth.users WHERE email = 'user@example.com';
   ```

2. **Invalid metadata**:
   - Check Stripe metadata includes required fields
   - Verify user_id format (UUID)

## Authentication Errors

### Problem: Token Exchange Failing

**Symptoms**:
- Users can't authenticate
- "Failed to exchange token" errors

**Check Firebase token**:
```javascript
// In browser console
firebase.auth().currentUser.getIdToken(true)
  .then(token => console.log(token))
  .catch(error => console.error(error));
```

**Check Supabase connection**:
```sql
-- Test Supabase connection
SELECT NOW();
```

**Check environment variables**:
```bash
# In Cloud Functions
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
echo $SUPABASE_JWT_SECRET
```

### Problem: Supabase User Creation Failing

**Symptoms**:
- Firebase auth works
- Supabase user not created
- "Could not find or create Supabase user" error

**Manual user creation**:
```sql
-- Create user manually
INSERT INTO auth.users (
  id, email, email_confirmed_at, created_at, updated_at
) VALUES (
  gen_random_uuid(), 'user@example.com', NOW(), NOW(), NOW()
);
```

**Check auth policies**:
```sql
-- Verify RLS policies allow user creation
\d+ auth.users
```

## Database Issues

### Problem: Connection Timeouts

**Symptoms**:
- Intermittent database errors
- "Connection timeout" messages

**Check connection pool**:
```sql
-- Check active connections
SELECT COUNT(*) FROM pg_stat_activity;

-- Check connection limits
SHOW max_connections;
```

**Solutions**:
1. Reduce connection pool size in application
2. Upgrade Supabase plan for more connections
3. Implement connection retry logic

### Problem: RLS Policy Blocking Operations

**Symptoms**:
- Operations fail silently
- No error messages
- Data not updating

**Test RLS policies**:
```sql
-- Disable RLS temporarily for testing
ALTER TABLE user_app_subscriptions DISABLE ROW LEVEL SECURITY;

-- Test operation
-- Re-enable RLS
ALTER TABLE user_app_subscriptions ENABLE ROW LEVEL SECURITY;
```

**Check policy definitions**:
```sql
-- View current policies
SELECT schemaname, tablename, policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'user_app_subscriptions';
```

## Stripe Integration

### Problem: API Key Issues

**Symptoms**:
- "Invalid API key" errors
- Authentication failures with Stripe

**Check API keys**:
```bash
# Test secret key
curl https://api.stripe.com/v1/account \
  -u sk_test_your_key:

# Check key format
echo $STRIPE_SECRET_KEY | cut -c1-7  # Should be "sk_live" or "sk_test"
```

### Problem: Webhook Event Processing

**Symptoms**:
- Events received but not processed correctly
- Wrong event types being handled

**Check event handling**:
```javascript
// In stripeWebhook.ts, add debugging
console.log('Received event:', event.type, event.id);

// Check event type mapping
switch (event.type) {
  case 'customer.subscription.created':
  case 'customer.subscription.updated':
    // Handle subscription events
    break;
  case 'payment_intent.succeeded':
    // Handle payment events
    break;
  default:
    console.log('Unhandled event type:', event.type);
}
```

### Problem: Test vs Live Mode Confusion

**Symptoms**:
- Test payments not working in production
- Live payments not working in development

**Check environment consistency**:
```bash
# Ensure all keys match environment
echo "Publishable: $(echo $STRIPE_PUBLISHABLE_KEY | cut -c1-7)"
echo "Secret: $(echo $STRIPE_SECRET_KEY | cut -c1-7)"
echo "Webhook: $(echo $STRIPE_WEBHOOK_SECRET | cut -c1-8)"
```

## Emergency Procedures

### Credit Emergency Addition

If a user's credits are stuck and they can't use the app:

```sql
-- Emergency credit addition
UPDATE user_app_subscriptions 
SET credits_remaining = credits_remaining + 100,
    updated_at = NOW()
WHERE user_id = 'user-uuid' 
  AND app_name = 'yours-brightly';

-- Log the manual intervention
INSERT INTO transaction_events (
  event_type, event_source, event_data, processing_status
) VALUES (
  'manual.credit_addition',
  'manual',
  '{"user_id": "user-uuid", "amount": 100, "reason": "Emergency fix"}'::jsonb,
  'success'
);
```

### Subscription Emergency Activation

If a user paid but subscription didn't activate:

```sql
-- Emergency subscription activation
INSERT INTO user_app_subscriptions (
  user_id, app_name, plan_tier, plan_status,
  credits_remaining, billing_provider_id,
  plan_start_at, plan_renewal_at
) VALUES (
  'user-uuid', 'yours-brightly', 'unlimited', 'active',
  999999, 'emergency_sub_' || extract(epoch from now()),
  NOW(), NOW() + INTERVAL '1 month'
) ON CONFLICT (user_id, app_name) DO UPDATE SET
  plan_tier = EXCLUDED.plan_tier,
  plan_status = EXCLUDED.plan_status,
  credits_remaining = EXCLUDED.credits_remaining,
  updated_at = NOW();
```

### System Health Reset

If the entire payment system seems stuck:

```sql
-- Reset stuck transactions (use carefully)
UPDATE user_transactions 
SET status = 'failed', updated_at = NOW()
WHERE status = 'pending' 
  AND created_at < NOW() - INTERVAL '6 hours';

-- Refresh user tokens
-- This would trigger token refresh for all users
-- Implement via Cloud Function if needed
```

## Prevention Best Practices

1. **Monitor webhook delivery** in Stripe Dashboard
2. **Set up alerts** for failed transactions
3. **Regular health checks** using the diagnostic queries
4. **Test payment flows** in staging environment
5. **Keep backups** of critical configuration
6. **Document any manual interventions**

## Contact Information

For payment system emergencies:

- **Stripe Support**: https://support.stripe.com
- **Supabase Support**: https://supabase.com/support
- **Firebase Support**: https://firebase.google.com/support

---

*Keep this guide updated as new issues are discovered and resolved.*

*Last updated: October 2, 2025*