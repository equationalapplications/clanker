# Subscription-Based Access Integration Guide

This guide shows how the subscription system provides automatic access control without requiring explicit terms acceptance modals.

## Components Overview

### 1. Subscription Configuration (`app/config/subscriptionConfig.ts`)
Centralized configuration for all subscription tiers:
```tsx
export interface SubscriptionTier {
  tier: 'free' | 'monthly_20' | 'monthly_50' | 'payg';
  name: string;
  price: number;
  credits: number;
  features: string[];
}
```

### 2. Automatic Access (No Modal Required)
The system now provides:
- Immediate free tier access for all authenticated users
- Automatic subscription provisioning via JWT claims
- Seamless tier-based feature gating
- No interruption for terms acceptance

### 3. SubscriptionGate (Replaces TermsGate)
Wrapper component that:
- Checks user's subscription tier via JWT `plans` array
- Controls access to premium features based on tier
- Handles subscription upgrade prompts when needed
- Manages subscription state via Supabase real-time

### 4. Subscription Management
Your subscription system now:
- Uses `get_user_plans()` to get current subscriptions
- Displays tier-appropriate features and content
- Handles billing integration via Stripe webhooks
- Automatically stays in sync with payment status

## Subscription Tiers

### Free Tier (Default)
All users automatically receive:
```tsx
{
  app: "yours-brightly",
  tier: "free",
  renewal: null,  // Never expires
  credits: 10     // Initial credits
}
```

### Paid Tiers
Upgraded via Stripe/billing integration:
- `monthly_20`: $20/month tier with premium features
- `monthly_50`: $50/month tier with all features
- `payg`: Pay-as-you-go credit-based usage

## Migration from Terms System

### Legacy Components (No Longer Used)
- ❌ AcceptTermsModal
- ❌ TermsGate  
- ❌ useAcceptTerms hook
- ❌ Terms acceptance enforcement
- ❌ Version checking and re-acceptance

### New Subscription Flow
- ✅ Automatic free tier access
- ✅ JWT includes subscription data
- ✅ RLS policies check subscription tier
- ✅ Seamless upgrade prompts when needed

## Integration Steps

### Step 1: Wrap premium features with SubscriptionGate

```tsx
import { SubscriptionGate } from '../components/SubscriptionGate';

function PremiumFeature() {
  return (
    <SubscriptionGate
      appName="yours-brightly"
      requiredTier="monthly_20"
      fallback={<UpgradePrompt />}
    >
      <PremiumFeatureContent />
    </SubscriptionGate>
  );
}
```

### Step 2: Check subscription status in components

```tsx
import { useSubscription } from '../hooks/useSubscription';

function MyComponent() {
  const { plans, hasAccess, tier } = useSubscription('yours-brightly');
  
  return (
    <View>
      <Text>Current tier: {tier}</Text>
      {hasAccess('monthly_20') && <PremiumButton />}
      {tier === 'payg' && <CreditCounter />}
    </View>
  );
}
```

## User Flow

1. **User opens app** → Automatically receives free tier access via JWT
2. **Feature access** → RLS policies check subscription tier in real-time
3. **Premium features** → SubscriptionGate prompts for upgrade if needed
4. **Billing integration** → Stripe webhooks update subscription status
5. **Real-time updates** → JWT refreshed automatically with new tier data

## Subscription Management

### Automatic Provisioning
When you deploy with the new system:
- All existing users automatically receive free tier access
- No interruption to user experience
- JWT tokens immediately include subscription data
- RLS policies enforce tier-based access

### Development Workflow
1. **Add new premium feature** in your component
2. **Wrap with SubscriptionGate** specifying required tier
3. **Test locally** - free tier users see upgrade prompts
4. **Deploy** - all users experience seamless tier-based access

## Configuration Structure

```tsx
// Subscription tier definitions
export const SUBSCRIPTION_TIERS = {
  free: {
    tier: 'free',
    name: 'Free',
    price: 0,
    credits: 10,
    features: ['Basic AI chat', 'Character creation', 'Limited templates']
  },
  monthly_20: {
    tier: 'monthly_20',
    name: 'Pro',
    price: 20,
    credits: 0, // Unlimited
    features: ['All free features', 'Premium templates', 'Priority support']
  },
  monthly_50: {
    tier: 'monthly_50', 
    name: 'Ultra',
    price: 50,
    credits: 0, // Unlimited
    features: ['All Pro features', 'API access', 'White-label', 'Custom AI']
  }
};

// JWT plans array structure
interface PlanClaim {
  app: string;
  tier: 'free' | 'monthly_20' | 'monthly_50' | 'payg';
  renewal: string | null;
  credits: number;
}
```

## Benefits

- ✅ **Immediate Access**: No barriers for new users
- ✅ **Seamless Upgrades**: Natural progression through tiers
- ✅ **Real-time Billing**: Instant subscription updates via webhooks
- ✅ **Developer Experience**: Simple tier-based feature gating
- ✅ **User Experience**: No interruptions or forced acceptance flows
- ✅ **Maintainability**: Clean subscription-based architecture
- ✅ **Scalability**: Easy to add new tiers and features

## Notes

- Free tier is automatically assigned to all authenticated users
- Subscription changes update JWT claims in real-time via webhooks
- RLS policies enforce tier-based access at the database level
- No user action required for basic app access
- Premium features naturally prompt for upgrades when accessed
- All subscription management handled through Stripe integration
