import React from 'react'
import { View, StyleSheet, Platform } from 'react-native'
import { Card, Text, Button, Chip, Snackbar, useTheme } from 'react-native-paper'
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
  // On web, parent (subscribe.tsx) owns expiredMessage. Only show local errorMessage.
  // On native, show errorMessage or expiredMessage since there's no parent snackbar.
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
      // On web: Stripe checkout has been opened in the browser. Keep buttons
      // disabled until Stripe navigates away from this tab.
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
      // On web: same as above — keep buttons disabled until user returns.
    } catch (e: any) {
      console.error(e)
      setErrorMessage(e?.message ?? 'Purchase failed. Please try again.')
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
                disabled={isSubscribeLocked}
                loading={isPurchasing === 'subscribe'}
              >
                Unlimited Subscription - $20/Month
              </Button>
            )}

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
            Sync Subscription &amp; Credits
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
