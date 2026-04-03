import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Card, Text, Button, Chip, useTheme } from 'react-native-paper'
import { useUserCredits } from '~/hooks/useUserCredits'
import LoadingIndicator from '~/components/LoadingIndicator'
import { makePackagePurchase } from '~/utilities/makePackagePurchase'
import { supabaseClient } from '~/config/supabaseClient'

export default function CreditsDisplay() {
  const { data: credits, isLoading, error, refetch } = useUserCredits()
  const { colors } = useTheme()
  const [isPurchasing, setIsPurchasing] = React.useState<'subscribe' | 'payg' | 'restore' | null>(null)

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

  const handleRestore = async () => {
    setIsPurchasing('restore')
    try {
      await supabaseClient.auth.refreshSession()
    } catch (e) {
      console.error('Restore failed:', e)
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

        <Button
          mode="text"
          onPress={handleRestore}
          disabled={isPurchasing !== null}
          loading={isPurchasing === 'restore'}
          style={styles.restoreButton}
        >
          Sync Subscription &amp; Credits
        </Button>
        <Text variant="bodySmall" style={[styles.syncHelperText, { color: colors.onSurfaceVariant }]}>
          Use this if your subscription or credits aren&apos;t showing correctly.
        </Text>
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
  actionsContainer: {
    gap: 8,
    marginBottom: 16,
  },
  actionButton: {
    marginVertical: 4,
  },
  restoreButton: {
    marginTop: 8,
  },
  syncHelperText: {
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  retryButton: {
    marginTop: 8,
  },
})
