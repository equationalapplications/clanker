import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Card, Text, Button, Chip, useTheme } from 'react-native-paper'
import { useUserCredits } from '~/hooks/useUserCredits'
import LoadingIndicator from '~/components/LoadingIndicator'

import { makePackagePurchase } from '~/utilities/makePackagePurchase'

export default function CreditsDisplay() {
  const { data: credits, isLoading, error, refetch } = useUserCredits()
  const { colors } = useTheme()
  const [isPurchasing, setIsPurchasing] = React.useState<'subscribe' | 'payg' | null>(null)

  if (isLoading) {
    return <LoadingIndicator />
  }

  if (error) {
    return (
      <Card style={[styles.errorCard, { backgroundColor: colors.errorContainer }]}>
        <Card.Content>
          <Text variant="bodyMedium">Error loading credits</Text>
          <Button onPress={() => refetch()} mode="outlined" style={styles.retryButton}>
            Retry
          </Button>
        </Card.Content>
      </Card>
    )
  }

  const handleBuyCredits = async () => {
    setIsPurchasing('payg')
    try {
      await makePackagePurchase('payg')
    } catch (e) {
      console.error(e)
    } finally {
      setIsPurchasing(null)
    }
  }

  const handleSubscribe = async () => {
    setIsPurchasing('subscribe')
    try {
      await makePackagePurchase('monthly_20')
    } catch (e) {
      console.error(e)
    } finally {
      setIsPurchasing(null)
    }
  }

  return (
    <Card style={styles.card}>
      <Card.Content>
        <Text variant="headlineSmall" style={styles.title}>
          Your Credits
        </Text>

        {credits?.hasUnlimited ? (
          <View style={styles.unlimitedContainer}>
            <Chip icon="infinity" mode="flat" style={[styles.unlimitedChip, { backgroundColor: colors.tertiaryContainer }]}>
              Unlimited Credits
            </Chip>
            <Text variant="bodyMedium" style={styles.description}>
              You have unlimited credits with your subscription!
            </Text>
            {credits.totalCredits > 0 && (
              <Text variant="bodySmall" style={[styles.savedCredits, { color: colors.onSurfaceVariant }]}>
                Plus {credits.totalCredits} saved credits for later
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.creditsContainer}>
            <Text variant="displaySmall" style={[styles.creditsCount, { color: colors.primary }]}>
              {credits?.totalCredits || 0}
            </Text>
            <Text variant="bodyMedium">Credits Available</Text>
          </View>
        )}

        <View style={styles.subscriptionDetails}>
          {credits?.subscriptions.map((sub, index) => (
            <View key={index} style={styles.subscriptionItem}>
              <Text variant="bodyMedium" style={styles.subscriptionText}>
                {sub.tier === 'free' && 'Free Tier'}
                {sub.tier === 'monthly_20' && 'Monthly $20 Plan'}
                {sub.tier === 'monthly_50' && 'Monthly $50 Premium Plan'}
                {sub.tier === 'payg' && 'Pay-as-you-go Credits'}
              </Text>
              {!sub.isUnlimited && (
                <Text variant="bodySmall" style={[styles.creditsText, { color: colors.onSurfaceVariant }]}>
                  {sub.credits} credits
                </Text>
              )}
            </View>
          ))}
        </View>

        <View style={styles.actionsContainer}>
          {!credits?.hasUnlimited && (
            <Button
              mode="contained"
              onPress={handleSubscribe}
              style={styles.actionButton}
              disabled={isPurchasing !== null}
              loading={isPurchasing === 'subscribe'}
            >
              Unlimited Subscription - $20/Month
            </Button>
          )}

          <Button
            mode="outlined"
            onPress={handleBuyCredits}
            style={styles.actionButton}
            disabled={isPurchasing !== null}
            loading={isPurchasing === 'payg'}
          >
            Buy 100 Credits - $10
          </Button>
        </View>

        <View style={[styles.pricingInfo, { borderTopColor: colors.outlineVariant }]}>
          <Text variant="bodySmall" style={[styles.pricingText, { color: colors.onSurfaceVariant }]}>
            • Unlimited Subscription: $20/month
          </Text>
          <Text variant="bodySmall" style={[styles.pricingText, { color: colors.onSurfaceVariant }]}>
            • One-time: 100 credits for $10
          </Text>
        </View>
      </Card.Content>
    </Card>
  )
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
  },
  errorCard: {
    margin: 16,
  },
  title: {
    marginBottom: 16,
    textAlign: 'center',
  },
  unlimitedContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  unlimitedChip: {
    marginBottom: 8,
  },
  description: {
    textAlign: 'center',
    marginBottom: 4,
  },
  savedCredits: {
    textAlign: 'center',
  },
  creditsContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  creditsCount: {
    fontWeight: 'bold',
  },
  subscriptionDetails: {
    marginBottom: 16,
  },
  subscriptionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  subscriptionText: {
    flex: 1,
  },
  creditsText: {},
  actionsContainer: {
    gap: 8,
    marginBottom: 16,
  },
  actionButton: {
    marginVertical: 4,
  },
  pricingInfo: {
    borderTopWidth: 1,
    paddingTop: 12,
  },
  pricingText: {
    marginVertical: 2,
  },
  retryButton: {
    marginTop: 8,
  },
})
