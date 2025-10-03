# Payment Integration Guide - React Native

This guide covers integrating the payment system specifically in the Yours Brightly AI React Native application.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Credit Management](#credit-management)
3. [Subscription Management](#subscription-management)
4. [Transaction History](#transaction-history)
5. [Error Handling](#error-handling)
6. [Testing](#testing)

## Quick Start

### 1. Install Dependencies

```bash
npm install @stripe/stripe-react-native @tanstack/react-query
```

### 2. Set up Stripe

```typescript
// App.tsx
import { StripeProvider } from '@stripe/stripe-react-native';

const STRIPE_PUBLISHABLE_KEY = 'pk_live_your_publishable_key';

export default function App() {
  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      {/* Your app content */}
    </StripeProvider>
  );
}
```

### 3. Configure Query Client

```typescript
// App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        {/* Your app content */}
      </StripeProvider>
    </QueryClientProvider>
  );
}
```

## Credit Management

### Real-time Credit Hook

```typescript
// hooks/useUserCredits.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';

export interface UserCredits {
  remaining: number;
  unlimited: boolean;
  planTier: string;
  renewalDate?: string;
}

export const useUserCredits = (userId: string) => {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['userCredits', userId],
    queryFn: async (): Promise<UserCredits> => {
      const { data, error } = await supabase
        .from('user_app_subscriptions')
        .select('plan_tier, credits_remaining, plan_renewal_at, plan_status')
        .eq('user_id', userId)
        .eq('app_name', 'yours-brightly')
        .eq('plan_status', 'active')
        .single();

      if (error) {
        // Return default free tier if no subscription found
        return {
          remaining: 50,
          unlimited: false,
          planTier: 'free'
        };
      }

      const unlimited = data.plan_tier === 'unlimited';
      return {
        remaining: unlimited ? 999999 : (data.credits_remaining || 0),
        unlimited,
        planTier: data.plan_tier,
        renewalDate: data.plan_renewal_at
      };
    },
    refetchInterval: 30000, // Refetch every 30 seconds
    staleTime: 10000, // Consider stale after 10 seconds
  });
};

// Mutation for deducting credits
export const useDeductCredits = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, amount }: { userId: string; amount: number }) => {
      const { data, error } = await supabase.rpc('deduct_user_credits', {
        p_user_id: userId,
        p_app_name: 'yours-brightly',
        p_credit_amount: amount
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { userId }) => {
      // Invalidate credits cache to refetch
      queryClient.invalidateQueries(['userCredits', userId]);
    }
  });
};
```

### Credit Counter Component

```typescript
// components/CreditCounterIcon.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useUserCredits } from '../hooks/useUserCredits';
import { useAuth } from '../hooks/useAuth';
import { router } from 'expo-router';

export const CreditCounterIcon: React.FC = () => {
  const { user } = useAuth();
  const { data: credits, isLoading, error } = useUserCredits(user?.id);

  const handlePress = () => {
    router.push('/credits');
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <TouchableOpacity style={styles.container} onPress={handlePress}>
        <Text style={styles.errorText}>!</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={styles.container} onPress={handlePress}>
      <View style={styles.content}>
        {credits?.unlimited ? (
          <Text style={styles.unlimitedText}>∞</Text>
        ) : (
          <Text style={styles.creditText}>{credits?.remaining || 0}</Text>
        )}
        <Text style={styles.labelText}>credits</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#4F46E5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 60,
  },
  content: {
    alignItems: 'center',
  },
  creditText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  unlimitedText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  labelText: {
    color: 'white',
    fontSize: 10,
    opacity: 0.8,
  },
  loadingText: {
    color: 'white',
    fontSize: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
```

### Credit Purchase Flow

```typescript
// components/CreditPurchaseOptions.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { useAuth } from '../hooks/useAuth';

interface CreditOption {
  credits: number;
  price: number;
  priceId: string;
  popular?: boolean;
}

const creditOptions: CreditOption[] = [
  {
    credits: 100,
    price: 3,
    priceId: 'price_credits_100',
  },
  {
    credits: 1000,
    price: 20,
    priceId: 'price_credits_1000',
    popular: true,
  },
];

export const CreditPurchaseOptions: React.FC = () => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { user } = useAuth();

  const handlePurchase = async (option: CreditOption) => {
    try {
      // Create payment intent
      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: option.price * 100, // Convert to cents
          currency: 'usd',
          metadata: {
            user_id: user?.id,
            credit_amount: option.credits.toString(),
            app_name: 'yours-brightly',
          },
        }),
      });

      const { client_secret, customer_id } = await response.json();

      // Initialize payment sheet
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: client_secret,
        customerId: customer_id,
        merchantDisplayName: 'Yours Brightly AI',
        style: 'alwaysDark',
      });

      if (initError) {
        Alert.alert('Error', initError.message);
        return;
      }

      // Present payment sheet
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        Alert.alert('Error', presentError.message);
        return;
      }

      Alert.alert(
        'Success!',
        `Your ${option.credits} credits have been added to your account.`
      );
    } catch (error) {
      console.error('Purchase error:', error);
      Alert.alert('Error', 'Failed to process purchase. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Purchase Credits</Text>
      {creditOptions.map((option) => (
        <TouchableOpacity
          key={option.priceId}
          style={[styles.option, option.popular && styles.popularOption]}
          onPress={() => handlePurchase(option)}
        >
          {option.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>Most Popular</Text>
            </View>
          )}
          <Text style={styles.creditsText}>{option.credits} Credits</Text>
          <Text style={styles.priceText}>${option.price}</Text>
          <Text style={styles.valueText}>
            ${(option.price / option.credits).toFixed(3)} per credit
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  option: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
  },
  popularOption: {
    borderColor: '#4F46E5',
    backgroundColor: '#EEF2FF',
  },
  popularBadge: {
    position: 'absolute',
    top: -8,
    right: 20,
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  popularText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  creditsText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  priceText: {
    fontSize: 18,
    color: '#4F46E5',
    fontWeight: '600',
    marginBottom: 4,
  },
  valueText: {
    fontSize: 14,
    color: '#6B7280',
  },
});
```

## Subscription Management

### Subscription Hook

```typescript
// hooks/useSubscription.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';

export interface Subscription {
  id: string;
  planTier: string;
  planStatus: 'active' | 'cancelled' | 'expired';
  creditsRemaining: number;
  renewalDate?: string;
  billingProviderId: string;
}

export const useSubscription = (userId: string) => {
  return useQuery({
    queryKey: ['subscription', userId],
    queryFn: async (): Promise<Subscription | null> => {
      const { data, error } = await supabase
        .from('user_app_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('app_name', 'yours-brightly')
        .in('plan_tier', ['unlimited', 'monthly_1000'])
        .eq('plan_status', 'active')
        .single();

      if (error) return null;

      return {
        id: data.id,
        planTier: data.plan_tier,
        planStatus: data.plan_status,
        creditsRemaining: data.credits_remaining || 0,
        renewalDate: data.plan_renewal_at,
        billingProviderId: data.billing_provider_id,
      };
    },
  });
};

export const useCancelSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      // This would call your backend API to cancel with Stripe
      const response = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['subscription']);
      queryClient.invalidateQueries(['userCredits']);
    },
  });
};
```

### Subscription Plans Component

```typescript
// components/SubscriptionPlans.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSubscription } from '../hooks/useSubscription';
import { useAuth } from '../hooks/useAuth';

const plans = [
  {
    id: 'unlimited',
    name: 'Unlimited',
    price: 50,
    priceId: 'price_unlimited_monthly',
    features: ['Unlimited AI generations', 'Priority support', 'Advanced features'],
  },
];

export const SubscriptionPlans: React.FC = () => {
  const { user } = useAuth();
  const { data: subscription } = useSubscription(user?.id);

  const handleSubscribe = async (priceId: string) => {
    try {
      // Create Stripe Checkout session
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          userId: user?.id,
          successUrl: 'yourapp://subscription-success',
          cancelUrl: 'yourapp://subscription-cancel',
        }),
      });

      const { url } = await response.json();
      
      // Open Stripe Checkout in web browser
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Failed to start subscription. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Subscription Plans</Text>
      
      {subscription && (
        <View style={styles.currentPlan}>
          <Text style={styles.currentPlanTitle}>Current Plan</Text>
          <Text style={styles.currentPlanName}>{subscription.planTier}</Text>
          <Text style={styles.renewalText}>
            Renews on {new Date(subscription.renewalDate!).toLocaleDateString()}
          </Text>
        </View>
      )}

      {plans.map((plan) => (
        <View key={plan.id} style={styles.planCard}>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.planPrice}>${plan.price}/month</Text>
          
          <View style={styles.features}>
            {plan.features.map((feature, index) => (
              <Text key={index} style={styles.feature}>• {feature}</Text>
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.subscribeButton,
              subscription?.planTier === plan.id && styles.activeButton
            ]}
            onPress={() => handleSubscribe(plan.priceId)}
            disabled={subscription?.planTier === plan.id}
          >
            <Text style={styles.subscribeButtonText}>
              {subscription?.planTier === plan.id ? 'Active' : 'Subscribe'}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  currentPlan: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  currentPlanTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  currentPlanName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4F46E5',
    marginBottom: 4,
  },
  renewalText: {
    fontSize: 14,
    color: '#6B7280',
  },
  planCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  planName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  planPrice: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4F46E5',
    marginBottom: 12,
  },
  features: {
    marginBottom: 16,
  },
  feature: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  subscribeButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeButton: {
    backgroundColor: '#9CA3AF',
  },
  subscribeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
```

## Transaction History

### Transaction History Hook

```typescript
// hooks/useTransactionHistory.ts
import { useInfiniteQuery } from '@tanstack/react-query';

export interface Transaction {
  id: string;
  transactionId: string;
  transactionType: 'subscription' | 'one_time' | 'refund';
  amountCents: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  createdAt: string;
  providerMetadata: any;
  internalMetadata: any;
}

const TRANSACTION_MANAGER_URL = 'https://transactionmanager-[hash]-uc.a.run.app';

export const useTransactionHistory = (userId: string) => {
  return useInfiniteQuery({
    queryKey: ['transactionHistory', userId],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(
        `${TRANSACTION_MANAGER_URL}?action=list&user_id=${userId}&app_name=yours-brightly&limit=20&offset=${pageParam}`
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const result = await response.json();
      return {
        transactions: result.data,
        nextOffset: result.data.length === 20 ? pageParam + 20 : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });
};
```

### Transaction History Component

```typescript
// components/TransactionHistory.tsx
import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useTransactionHistory } from '../hooks/useTransactionHistory';
import { useAuth } from '../hooks/useAuth';

const TransactionItem: React.FC<{ transaction: Transaction }> = ({ transaction }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10B981';
      case 'pending': return '#F59E0B';
      case 'failed': return '#EF4444';
      case 'refunded': return '#6366F1';
      default: return '#6B7280';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'subscription': return '🔄';
      case 'one_time': return '💳';
      case 'refund': return '↩️';
      default: return '💰';
    }
  };

  return (
    <View style={styles.transactionItem}>
      <View style={styles.transactionHeader}>
        <Text style={styles.transactionIcon}>
          {getTypeIcon(transaction.transactionType)}
        </Text>
        <View style={styles.transactionInfo}>
          <Text style={styles.transactionType}>
            {transaction.transactionType === 'one_time' ? 'Credit Purchase' : 
             transaction.transactionType === 'subscription' ? 'Subscription' : 'Refund'}
          </Text>
          <Text style={styles.transactionDate}>
            {new Date(transaction.createdAt).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.transactionAmount}>
          <Text style={styles.amountText}>
            ${(transaction.amountCents / 100).toFixed(2)}
          </Text>
          <Text style={[styles.statusText, { color: getStatusColor(transaction.status) }]}>
            {transaction.status}
          </Text>
        </View>
      </View>
      
      {transaction.internalMetadata?.credit_amount && (
        <Text style={styles.creditsText}>
          +{transaction.internalMetadata.credit_amount} credits
        </Text>
      )}
    </View>
  );
};

export const TransactionHistory: React.FC = () => {
  const { user } = useAuth();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    isRefreshing,
  } = useTransactionHistory(user?.id);

  const transactions = data?.pages.flatMap(page => page.transactions) || [];

  const renderItem = ({ item }: { item: Transaction }) => (
    <TransactionItem transaction={item} />
  );

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    
    return (
      <View style={styles.loadingFooter}>
        <Text>Loading more...</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transaction History</Text>
      
      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        onEndReached={() => hasNextPage && fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refetch} />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContainer}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    padding: 20,
    paddingBottom: 10,
  },
  listContainer: {
    padding: 20,
    paddingTop: 0,
  },
  transactionItem: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  transactionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transactionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 14,
    color: '#6B7280',
  },
  transactionAmount: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  creditsText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
    marginTop: 8,
  },
  loadingFooter: {
    padding: 20,
    alignItems: 'center',
  },
});
```

## Error Handling

### Global Error Handler

```typescript
// utils/errorHandler.ts
import { Alert } from 'react-native';

export interface PaymentError {
  code: string;
  message: string;
  type: 'payment' | 'network' | 'validation' | 'server';
}

export const handlePaymentError = (error: any): PaymentError => {
  console.error('Payment error:', error);

  // Stripe errors
  if (error.code) {
    switch (error.code) {
      case 'card_declined':
        return {
          code: error.code,
          message: 'Your card was declined. Please try a different payment method.',
          type: 'payment'
        };
      case 'insufficient_funds':
        return {
          code: error.code,
          message: 'Your card has insufficient funds.',
          type: 'payment'
        };
      case 'expired_card':
        return {
          code: error.code,
          message: 'Your card has expired.',
          type: 'payment'
        };
      default:
        return {
          code: error.code,
          message: error.message || 'Payment failed. Please try again.',
          type: 'payment'
        };
    }
  }

  // Network errors
  if (error.message?.includes('Network')) {
    return {
      code: 'network_error',
      message: 'Network error. Please check your connection and try again.',
      type: 'network'
    };
  }

  // Default error
  return {
    code: 'unknown_error',
    message: 'An unexpected error occurred. Please try again.',
    type: 'server'
  };
};

export const showPaymentError = (error: PaymentError) => {
  Alert.alert('Payment Error', error.message, [{ text: 'OK' }]);
};
```

### Error Boundary Component

```typescript
// components/PaymentErrorBoundary.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class PaymentErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Payment error boundary caught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            We encountered an error with the payment system.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return <>{this.props.children}</>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    color: '#6B7280',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
```

## Testing

### Test Stripe Setup

```typescript
// utils/testHelpers.ts
export const STRIPE_TEST_CARDS = {
  VISA: '4242424242424242',
  VISA_DEBIT: '4000056655665556',
  MASTERCARD: '5555555555554444',
  DECLINED: '4000000000000002',
  INSUFFICIENT_FUNDS: '4000000000009995',
};

export const createTestPaymentMethod = async (cardNumber: string = STRIPE_TEST_CARDS.VISA) => {
  // This is for testing only - implement based on your test setup
  return {
    id: 'pm_test_' + Math.random().toString(36).substr(2, 9),
    card: {
      brand: 'visa',
      last4: cardNumber.slice(-4),
    },
  };
};
```

### Test Credit Purchase

```typescript
// __tests__/creditPurchase.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { useUserCredits, useDeductCredits } from '../hooks/useUserCredits';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('Credit Purchase Flow', () => {
  it('should fetch user credits', async () => {
    const { result } = renderHook(
      () => useUserCredits('test-user-id'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual({
      remaining: expect.any(Number),
      unlimited: expect.any(Boolean),
      planTier: expect.any(String),
    });
  });

  it('should deduct credits', async () => {
    const { result } = renderHook(
      () => useDeductCredits(),
      { wrapper: createWrapper() }
    );

    result.current.mutate({
      userId: 'test-user-id',
      amount: 1,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});
```

---

This integration guide provides everything needed to implement the payment system in your React Native app. The components are designed to work with Expo Router and integrate seamlessly with your existing authentication system.

*Last updated: October 2, 2025*