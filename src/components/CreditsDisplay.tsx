import React from 'react'
import { View, StyleSheet, Platform } from 'react-native'
import { Card, Text, Button, Snackbar, useTheme } from 'react-native-paper'
import { useUserCredits } from '~/hooks/useUserCredits'
import LoadingIndicator from '~/components/LoadingIndicator'
import { makePackagePurchase } from '~/utilities/makePackagePurchase'
import { useBootstrapRefresh } from '~/hooks/useBootstrapRefresh'
import type { WebCheckoutLocks } from '~/hooks/useWebCheckoutSync'

interface CreditsDisplayProps {
  webCheckoutLocks?: WebCheckoutLocks
  expiredMessage?: string | null
  onDismissExpiredMessage?: () => void
}

export default function CreditsDisplay({
  webCheckoutLocks,
  expiredMessage,
  onDismissExpiredMessage,
}: CreditsDisplayProps) {
  const { data: credits, isLoading, error, refetch } = useUserCredits()
  const refreshBootstrap = useBootstrapRefresh()
  const { colors } = useTheme()
  const [isPurchasing, setIsPurchasing] = React.useState<'subscribe' | 'payg' | 'restore' | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const webPurchaseStartRef = React.useRef<'subscribe' | 'payg' | null>(null)
  const isWeb = Platform.OS === 'web'
  const isLocalWebPurchaseLocked = isWeb && (isPurchasing === 'subscribe' || isPurchasing === 'payg')
  const isSubscribeLocked = isWeb
    ? (isLocalWebPurchaseLocked || !!webCheckoutLocks?.isSubscribeLocked)
    : isPurchasing !== null
  const isPaygLocked = isWeb
    ? (isLocalWebPurchaseLocked || !!webCheckoutLocks?.isPaygLocked)
    : isPurchasing !== null
  const snackbarMessage = isWeb ? errorMessage : errorMessage ?? expiredMessage

  const handleDismissSnackbar = () => {
    setErrorMessage(null)
    if (!isWeb) {
      onDismissExpiredMessage?.()
    }
  }

  const tryStartPurchase = (purchaseType: 'subscribe' | 'payg') => {
    if (isWeb) {
      if (webPurchaseStartRef.current !== null) {
        return false
      }

      webPurchaseStartRef.current = purchaseType
    }

    setIsPurchasing(purchaseType)
    return true
  }

  const resetPurchaseState = () => {
    webPurchaseStartRef.current = null
    setIsPurchasing(null)
  }

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
    if (!tryStartPurchase('payg')) {
      return
    }

    try {
      const purchaseResult = await makePackagePurchase('payg')
      if (Platform.OS !== 'web' && purchaseResult != null) {
        refreshBootstrap('purchase')
      }
    } catch (e) {
      console.error(e)
      setErrorMessage('Purchase failed. Please try again.')
      if (Platform.OS === 'web') {
        resetPurchaseState()
      }
    } finally {
      if (Platform.OS !== 'web') {
        resetPurchaseState()
      }
    }
  }

  const handleSubscribe = async () => {
    if (!tryStartPurchase('subscribe')) {
      return
    }

    try {
      const purchaseResult = await makePackagePurchase('monthly_20')
      if (Platform.OS !== 'web' && purchaseResult != null) {
        refreshBootstrap('purchase')
      }
    } catch (e: any) {
      console.error(e)
      setErrorMessage('Purchase failed. Please try again.')
      if (Platform.OS === 'web') {
        resetPurchaseState()
      }
    } finally {
      if (Platform.OS !== 'web') {
        resetPurchaseState()
      }
    }
  }

  const handleRestore = async () => {
    setIsPurchasing('restore')
    try {
      refreshBootstrap('restore')
    } catch (e) {
      console.error('Restore failed:', e)
      setErrorMessage('Sync failed. Please try again.')
    } finally {
      setIsPurchasing(null)
    }
  }

  return (
    <>
      <Card style={styles.card}>
        <Card.Content>
          <Text variant="headlineSmall" style={styles.title}>
            Your Credits
          </Text>

          <View style={styles.creditsContainer}>
            <Text variant="displaySmall" style={[styles.creditsCount, { color: colors.primary }]}>
              {credits?.totalCredits || 0}
            </Text>
            <Text variant="bodyMedium">Credits Available</Text>
            {credits?.nextExpiryDate && credits.totalCredits > 0 && (
              <Text variant="bodySmall" style={[styles.expiryText, { color: colors.onSurfaceVariant }]}>
                Credits expire {new Date(credits.nextExpiryDate).toLocaleDateString()}
              </Text>
            )}
          </View>

          <View style={styles.actionsContainer}>
            <Button
              mode="contained"
              onPress={handleSubscribe}
              style={styles.actionButton}
              disabled={isSubscribeLocked}
              loading={isPurchasing === 'subscribe'}
            >
              300 credits / month · $20
            </Button>

            <Button
              mode="outlined"
              onPress={handleBuyCredits}
              style={styles.actionButton}
              disabled={isPaygLocked}
              loading={isPurchasing === 'payg'}
            >
              Buy 100 Credits - $10
            </Button>
          </View>

          <Button
            mode="text"
            onPress={handleRestore}
            disabled={Platform.OS === 'web' ? isPurchasing === 'restore' : isPurchasing !== null}
            loading={isPurchasing === 'restore'}
            style={styles.restoreButton}
          >
            Sync Subscription & Credits
          </Button>
          <Text variant="bodySmall" style={[styles.syncHelperText, { color: colors.onSurfaceVariant }]}>
            Use this if your subscription or credits aren&apos;t showing correctly.
          </Text>
        </Card.Content>
      </Card>

      <Snackbar
        visible={snackbarMessage !== null}
        onDismiss={handleDismissSnackbar}
        duration={4000}
      >
        {snackbarMessage}
      </Snackbar>
    </>
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
  creditsContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  creditsCount: {
    fontWeight: 'bold',
  },
  expiryText: {
    marginTop: 6,
    textAlign: 'center',
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
