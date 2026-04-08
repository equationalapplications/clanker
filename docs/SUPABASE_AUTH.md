# Multi-Tenant Subscription System with Firebase + Supabase

This document describes our comprehensive multi-tenant subscription system that combines Firebase Authentication with Supabase for data access control, including subscription-based feature gating and JWT-based Row Level Security.

## 🏗️ Architecture Overview

### Hybrid Authentication + Subscription Flow

1. **Firebase Authentication**: Primary authentication provider (Google Sign-In, Email, etc.)
2. **Token Exchange**: Firebase Function generates pre-signed Supabase JWTs with subscription claims
3. **Supabase Session**: Client establishes Supabase session with subscription-enriched JWT
4. **Row Level Security**: Database access controlled by JWT subscription claims

### Core Components

- **Firebase Functions**: `exchangeToken` function for JWT generation with subscription data
- **Supabase Database**: Multi-tenant schema with subscription tracking
- **JWT Custom Claims**: Plans array for per-app subscription control
- **Subscription Tiers**: free, monthly_20, monthly_50, payg with feature differentiation

---

## 🗄️ Database Schema

### Subscription Tables

#### `user_app_subscriptions`

Tracks user subscription status per application with billing details.

```sql
CREATE TABLE public.user_app_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    plan_tier TEXT NOT NULL CHECK (plan_tier IN ('free', 'monthly_20', 'monthly_50', 'payg')),
    plan_status TEXT NOT NULL DEFAULT 'active' CHECK (plan_status IN ('active', 'cancelled', 'expired')),
    plan_start_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    plan_renewal_at TIMESTAMP WITH TIME ZONE,
    current_credits INTEGER NOT NULL DEFAULT 0,
    terms_accepted_at TIMESTAMP WITH TIME ZONE,
    terms_version TEXT,
    plan_quantity INTEGER DEFAULT 1,
    billing_provider_id TEXT, -- External subscription ID
    billing_metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(user_id, app_name)  -- One active subscription per user per app
);
```


---

## 🔑 Subscription Functions

### Helper Functions for RLS

#### `user_has_app_access(app_name TEXT) RETURNS BOOLEAN`

Checks if user has any active subscription for the specified app.

```sql
CREATE OR REPLACE FUNCTION public.user_has_app_access(app_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'plans', '[]'::jsonb)) AS plan
        WHERE plan ->> 'app' = app_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### `user_has_tier_access(app_name TEXT, required_tier TEXT) RETURNS BOOLEAN`

Checks if user has sufficient subscription tier for feature access.

```sql
-- Tier hierarchy: 'free' < 'monthly_20' < 'monthly_50'
-- 'payg' tier checked separately for credits
```

#### `user_has_credits(app_name TEXT, required_credits INTEGER) RETURNS BOOLEAN`

Validates sufficient credits for pay-as-you-go operations.

#### `get_user_plan_tier(app_name TEXT) RETURNS TEXT`

Returns user's current tier for an app ('free', 'monthly_20', 'monthly_50', 'payg', 'no_access').

### Core Functions

#### `get_user_plans(user_id UUID) RETURNS JSONB`

Returns compact JSONB array of user's active plans for JWT inclusion.

```sql
-- Returns: [{"app": "clanker", "tier": "monthly_20"}]
-- Only includes active subscriptions — presence in the array implies active status.
-- Excludes volatile data (credits) and non-critical data (renewal dates, terms acceptance).
-- These should be queried in real-time when needed, not cached in JWT.
```

---

## 🔥 Firebase Integration & JWT Claims

### Authentication Flow Overview

1. **Firebase Authentication**: User signs in with Firebase (Google, email, etc.)
2. **exchangeToken Cloud Function**: Creates/finds Supabase user via Admin API
3. **Supabase Auth Hook**: Automatically adds subscription `plans` to JWT claims
4. **Client Session**: Establishes Supabase session with subscription-enriched JWT

### exchangeToken Cloud Function

Located in `functions/src/exchangeToken.ts`, this function:

1. **Validates Firebase Authentication**: Verifies Firebase ID token from request context
2. **User Management**: Finds or creates Supabase user via Admin API
3. **Session Retrieval**: Returns Supabase session for the user

```typescript
// The function validates Firebase auth and returns a Supabase session
export const exchangeToken = onCall(async (request) => {
  // Verify Firebase authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const email = request.auth.token.email

  // Find or create Supabase user
  let supabaseUserId = await findSupabaseUserByEmail(email)
  if (!supabaseUserId) {
    supabaseUserId = await createSupabaseUser(email, request.auth.uid)
  }

  // Get Supabase session (JWT claims added by auth hook)
  const session = await getSupabaseUserSession(supabaseUserId)

  return { session }
})
```

### Custom Access Token Hook

Located in the database as `public.custom_access_token_hook`, this Supabase auth hook automatically adds subscription claims to JWTs:

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
    claims JSONB;
    user_plans JSONB;
BEGIN
    -- Get user's subscription plans
    SELECT public.get_user_plans((event->>'user_id')::UUID) INTO user_plans;

    -- If no plans found, return empty array
    IF user_plans IS NULL THEN
        user_plans := '[]'::jsonb;
    END IF;

    -- Add plans to JWT claims
    claims := jsonb_build_object('plans', user_plans);
    RETURN jsonb_set(event, '{claims}', claims);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Note**: The hook is generic and multi-tenant. It does not assign default plans. Applications should handle access control based on the `plans` array in the JWT, which may be empty for users without subscriptions.

#### JWT Claims Structure (Added by Auth Hook)

The auth hook automatically enriches JWTs with the `plans` array containing minimal, access-control focused data:

```json
{
  "sub": "user-uuid",
  "role": "authenticated",
  "email": "user@example.com",
  "plans": [
    {
      "app": "clanker",
      "tier": "monthly_20"
    }
  ]
}
```

**JWT Design Principles:**

- ✅ **Minimal Data**: Only includes data needed for access control decisions
- ✅ **Low Volatility**: Excludes rapidly changing data
- ✅ **Presence Implies Active**: The hook only emits active subscriptions — being in the array is sufficient for RLS checks
- ❌ **No Status Field**: Redundant — inactive subscriptions are excluded at the source
- ❌ **No Credits**: Query in real-time to avoid stale data
- ❌ **No Renewal Dates**: Fetch from database when displaying billing UI
- ❌ **No Terms Acceptance**: Query in real-time to check current terms status

#### Users Without Subscriptions

Users without active apps will have an empty `plans` array:

```json
{
  "sub": "user-uuid",
  "role": "authenticated",
  "email": "user@example.com",
  "plans": []
}
```

Application logic should handle granting free tier access or prompting for subscription as needed.

#### Environment Variables Required (Firebase Functions)

```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_URL=your_supabase_url
```

#### Enabling the Auth Hook

To enable the custom access token hook in Supabase:

1. **Grant Permissions** (run in Supabase SQL Editor):

```sql
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
```

2. **Configure in Dashboard**:
   - Go to Authentication > Hooks
   - Enable "Custom Access Token Hook"
   - Set Schema: `public`
   - Set Function: `custom_access_token_hook`

> Note: For a concise, end-to-end description of the Firebase → Supabase auth flow, see [AUTH_FLOW.md](./AUTH_FLOW.md).

---

## 🔒 Row Level Security (RLS) Policies

### Subscription-Based Access Control

All app-specific tables use RLS policies that check the `plans` array in the JWT:




### Subscription Tier Examples

#### Free Tier (`tier: "free"`)

- Basic app access
- Limited features
- 50 credits included

#### Monthly $20 Tier (`tier: "monthly_20"`)

- All free features
- Premium features unlocked
- Advanced templates, priority support

#### Monthly $50 Tier (`tier: "monthly_50"`)

- All monthly_20 features
- Ultra premium features
- API access, white-label, unlimited AI

#### Pay-as-You-Go (`tier: "payg"`)

- Credit-based consumption
- Access based on remaining credits
- Flexible usage model

---

## 📋 Terms Acceptance System

### Terms Lifecycle (Legacy - Now Handled via Subscriptions)

1. **New User**: Automatically receives free tier subscription via JWT
2. **Terms Acceptance**: Handled through subscription creation process
3. **Access Granted**: JWT includes free tier in `plans` array immediately
4. **Subscription Upgrades**: Paid subscriptions modify `plans` array data

### Subscription-Based Access

Users now receive access through the subscription system rather than explicit terms acceptance:

- **Free Tier**: Automatically granted to all authenticated users
- **Paid Tiers**: Granted through Stripe/billing integration
- **Access Control**: Based on `plans` array in JWT claims
- **Feature Gating**: Tier-based access control via RLS policies

---

## 🚀 Client Implementation

### Authentication Flow

#### 1. Firebase Authentication

```typescript
// User signs in with Firebase (Google, email, etc.)
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
```

#### 2. Token Exchange

```typescript
// Exchange Firebase token for Supabase JWT
import { loginToSupabaseAfterFirebase } from './utilities/loginToSupabaseAfterFirebase'

const authData = await loginToSupabaseAfterFirebase()
// Returns: { supabaseAccessToken, supabaseRefreshToken }
```

#### 3. Supabase Session

```typescript
// Establish Supabase session with dual tokens
await supabase.auth.setSession({
  access_token: supabaseAccessToken, // 1 hour with full claims
  refresh_token: supabaseRefreshToken, // 24 hours for renewal
})
```

### JWT Claims Structure

#### Access Token Claims (Plans-Only)

```json
{
  "sub": "user-uuid",
  "role": "authenticated",
  "iat": 1234567890,
  "exp": 1234571490,
  "aud": "authenticated",
  "email": "user@example.com",
  "plans": [
    {
      "app": "clanker",
      "tier": "monthly_20"
    }
  ],
  "token_type": "access"
}
```

#### Refresh Token Claims

```json
{
  "sub": "user-uuid",
  "role": "authenticated",
  "iat": 1234567890,
  "exp": 1234654290,
  "aud": "authenticated",
  "token_type": "refresh"
}
```

---

## 🛠️ Development Workflow

### Adding a New App

1. **Update App Names**: Add new app name to your constants
2. **Create App Table**:
   ```sql
   CREATE TABLE public.new_app (
       user_id UUID NOT NULL REFERENCES auth.users(id),
       -- app-specific fields
   );
   ```
3. **Add RLS Policies**: Copy and modify existing subscription-based policies for new app
4. **Update Functions**: Modify subscription functions to handle new app
5. **Client Integration**: Add subscription tiers for new app

### Testing Authentication

#### Check JWT Claims

```javascript
// In browser console
const session = await supabase.auth.getSession()
const token = session.data.session?.access_token
const payload = JSON.parse(atob(token.split('.')[1]))
console.log('JWT Claims:', payload)
console.log('Plans Array:', payload.plans)
```


---

## 🔍 Debugging Guide

### Common Issues

#### User Can't Access Data

1. **Check JWT Claims**: Verify `plans` array contains required app subscription
2. **Check Subscription Status**: Ensure subscription is active and not expired
3. **Check RLS Policies**: Verify policies are correctly checking JWT subscription claims

#### Subscription Not Working

1. **Check Function**: Ensure `get_user_plans()` returns correct subscription data
2. **Check Migration**: Verify subscription schema was applied with `supabase db push`
3. **Check JWT Generation**: Ensure `exchangeToken` uses updated query with subscription data

#### Free Tier Issues

1. **Check Default Assignment**: Verify new users receive free tier automatically
2. **Check Credits**: Ensure free tier users have initial credits assigned
3. **Check Policies**: Verify RLS policies allow free tier access where appropriate

#### Logging Points

```typescript
// Client-side debugging
console.log('🔐 JWT Payload:', tokenPayload)
console.log('� Subscription Plans:', tokenPayload.plans)
console.log('✅ Session Active:', !!supabaseSession)
```

---

## 📊 Monitoring & Analytics

### Key Metrics to Track

- **Subscription Conversion Rate**: % of users who upgrade from free tier
- **Tier Distribution**: Usage across free, monthly_20, monthly_50, payg tiers
- **JWT Refresh Success**: Token renewal success rate
- **RLS Policy Violations**: Failed data access attempts
- **Credit Usage**: Pay-as-you-go consumption patterns

### Database Queries for Insights

```sql
-- Users by subscription tier
SELECT
    app_name,
    plan_tier,
    COUNT(*) as user_count
FROM user_app_subscriptions
WHERE plan_status = 'active'
GROUP BY app_name, plan_tier;

-- Subscription revenue distribution
SELECT
    plan_tier,
    COUNT(*) as subscribers,
    COUNT(*) * CASE
        WHEN plan_tier = 'monthly_20' THEN 20
        WHEN plan_tier = 'monthly_50' THEN 50
        ELSE 0
    END as monthly_revenue
FROM user_app_subscriptions
WHERE app_name = 'clanker'
    AND plan_status = 'active'
GROUP BY plan_tier;
```

---

## 🚨 Security Considerations

### JWT Security

- ✅ **Short Access Token Lifetime**: 1 hour limits exposure window
- ✅ **Longer Refresh Token**: 24 hours reduces re-authentication friction
- ✅ **Minimal Refresh Claims**: Refresh tokens contain minimal data
- ✅ **Server-Side Generation**: JWTs generated by secure Firebase Function

### RLS Best Practices

- ✅ **Double-Check Ownership**: Always verify `auth.uid() = user_id`
- ✅ **Subscription Validation**: Always verify subscription access via JWT claims
- ✅ **Tier-Based Access**: Use helper functions for tier-specific feature gating
- ✅ **Policy Testing**: Test policies with different subscription scenarios
- ✅ **Credit Validation**: Verify sufficient credits for pay-as-you-go operations

### Subscription Compliance

- ✅ **Billing Integration**: Full audit trail of subscription events
- ✅ **Automatic Provisioning**: Free tier assigned to all users automatically
- ✅ **Access Revocation**: Automatic access removal when subscriptions expire
- ✅ **Granular Control**: Per-app, per-tier subscription tracking
- ✅ **Credit Management**: Real-time credit tracking and validation

---

This system provides enterprise-grade multi-tenant subscription management with comprehensive billing integration, ensuring both security and compliance while maintaining excellent user experience.
