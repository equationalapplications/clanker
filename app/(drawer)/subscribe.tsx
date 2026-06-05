import { useRouter } from 'expo-router'
import { useNavigation } from "expo-router/react-navigation"
import React, { useState } from 'react'
import { ScrollView, StyleSheet, View, Platform, Linking } from 'react-native'
import { Card, Text, IconButton, Button, Snackbar, List, Divider } from 'react-native-paper'

import CreditsDisplay from '~/components/CreditsDisplay'
import { useIsPremium } from '~/hooks/useIsPremium'
import { useUserPrivateData } from '~/hooks/useUser'
import { useBootstrapRefresh } from '~/hooks/useBootstrapRefresh'
import { useWebCheckoutSync } from '~/hooks/useWebCheckoutSync'
import { makePackagePurchase, type ProductType } from '~/utilities/makePackagePurchase'
import { restorePurchases } from '~/config/revenueCatConfig'
import { APPLE_EULA_URL } from '~/config/constants'

export default function SubscribeScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const refreshBootstrap = useBootstrapRefresh()
  const handleWebCheckoutSucceeded = React.useCallback(() => {
    refreshBootstrap('purchase')
  }, [refreshBootstrap])
  const { locks: webCheckoutLocks, expiredMessage, clearExpiredMessage } = useWebCheckoutSync({
    onCheckoutSucceeded: handleWebCheckoutSucceeded,
  })
  const isPremium = useIsPremium()

  // Override the drawer header title so the route-group name "(drawer)" never leaks through
  React.useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: 'Subscribe' })
  }, [navigation])
  const { userPrivate } = useUserPrivateData()
  const credits = userPrivate?.credits || 0
  const [inFlightAction, setInFlightAction] = useState<'monthly_20' | 'payg' | 'restore' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePurchase = async (productType: Extract<ProductType, 'monthly_20' | 'payg'>) => {
    setInFlightAction(productType)
    try {
      await makePackagePurchase(productType)
      refreshBootstrap('purchase')
    } catch (e) {
      console.error('Purchase failed:', e)
      setErrorMessage('Purchase failed. Please try again.')
    } finally {
      setInFlightAction(null)
    }
  }

  const handleRestore = async () => {
    setInFlightAction('restore')
    try {
      await restorePurchases()
      refreshBootstrap('restore')
    } catch (e) {
      console.error('Restore failed:', e)
      setErrorMessage('Restore failed. Please try again.')
    } finally {
      setInFlightAction(null)
    }
  }

  const handleOpenAppleEula = async () => {
    try {
      await Linking.openURL(APPLE_EULA_URL)
    } catch (e) {
      console.error('Failed to open Apple EULA URL:', e)
      setErrorMessage('Unable to open Apple EULA right now. Please try again.')
    }
  }

  const snackbarMessage = errorMessage ?? expiredMessage

  const handleDismissSnackbar = () => {
    setErrorMessage(null)
    clearExpiredMessage()
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.statusSection}>
              <Text variant="headlineMedium" style={styles.title}>
                {isPremium ? 'Monthly Credit Plan' : 'Choose Your Credits'}
              </Text>

              <View style={styles.creditsStatus}>
                <Text variant="bodyLarge" style={styles.statusText}>
                  {isPremium
                    ? 'You receive 300 credits each month. Credits expire at the end of each billing cycle.'
                    : `Current Credits: ${credits}`}
                </Text>
                <Text variant="bodyMedium" style={styles.description}>
                  Credits power chat, voice, images, and more. Purchase more anytime.
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>

        {Platform.OS === 'web' ? (
          <CreditsDisplay
            webCheckoutLocks={webCheckoutLocks}
            expiredMessage={expiredMessage}
            onDismissExpiredMessage={clearExpiredMessage}
          />
        ) : (
          <View style={styles.buttonContainer}>
            {!isPremium && (
              <Button
                mode="contained"
                onPress={() => handlePurchase('monthly_20')}
                disabled={inFlightAction !== null}
                loading={inFlightAction === 'monthly_20'}
                style={[styles.actionButton, { marginBottom: 12 }]}
              >
                300 credits / month · $20
              </Button>
            )}
            <Button
              mode="outlined"
              onPress={() => handlePurchase('payg')}
              disabled={inFlightAction !== null}
              loading={inFlightAction === 'payg'}
              style={styles.actionButton}
            >
              100 credits · $10
            </Button>
            <Button
              mode="text"
              onPress={handleRestore}
              disabled={inFlightAction !== null}
              loading={inFlightAction === 'restore'}
              style={styles.restoreButton}
            >
              Restore Purchases
            </Button>
            {Platform.OS === 'ios' && (
              <View style={styles.purchaseLegalContainer}>
                <Text variant="bodySmall" style={styles.purchaseLegalText}>
                  By subscribing, you agree to the Terms of Use. Auto-renewable subscriptions are
                  billed through the Apple App Store. The Apple Standard EULA applies.
                </Text>
                <View style={styles.purchaseLegalLinksRow}>
                  <Button compact mode="text" onPress={() => router.push('/terms')}>
                    Terms of Use
                  </Button>
                  <Button compact mode="text" onPress={() => router.push('/privacy')}>
                    Privacy Policy
                  </Button>
                  <Button compact mode="text" onPress={handleOpenAppleEula}>
                    Apple EULA
                  </Button>
                </View>
              </View>
            )}
          </View>
        )}

        {!isPremium && (
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="headlineSmall" style={styles.featuresTitle}>
                Why Buy Credits?
              </Text>

              <View style={styles.featuresList}>
                <View style={styles.feature}>
                  <IconButton icon="image" size={24} />
                  <Text variant="bodyMedium">Generate character images using credits</Text>
                </View>

                <View style={styles.feature}>
                  <IconButton icon="message" size={24} />
                  <Text variant="bodyMedium">Send more chat and voice replies</Text>
                </View>

                <View style={styles.feature}>
                  <IconButton icon="account-group" size={24} />
                  <Text variant="bodyMedium">Create and manage more characters</Text>
                </View>

                <View style={styles.feature}>
                  <IconButton icon="star" size={24} />
                  <Text variant="bodyMedium">Priority support for paid customers</Text>
                </View>
              </View>
            </Card.Content>
          </Card>
        )}

        <Card style={styles.card}>
          <Card.Content>
            <Text variant="headlineSmall" style={styles.featuresTitle}>
              Plan Comparison
            </Text>
            <View style={styles.featuresList}>
              <Text variant="bodyMedium">• Free Tier — 50 credits</Text>
              <Text variant="bodyMedium">• Monthly Plan — 300 credits for $20, renews monthly</Text>
              <Text variant="bodyMedium">• One-time Pack — 100 credits for $10, valid 31 days</Text>
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card}>
          <Card.Content style={styles.legalCardContent}>
            <Text variant="headlineSmall" style={styles.featuresTitle}>
              Legal
            </Text>

            <List.Item
              title="Terms of Use"
              left={(props) => <List.Icon {...props} icon="file-document" />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={() => router.push('/terms')}
            />
            <Divider />
            <List.Item
              title="Privacy Policy"
              left={(props) => <List.Icon {...props} icon="shield-check" />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={() => router.push('/privacy')}
            />
            <Divider />
            <List.Item
              title="Apple Standard EULA"
              left={(props) => <List.Icon {...props} icon="apple" />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={handleOpenAppleEula}
            />
          </Card.Content>
        </Card>
      </ScrollView>

      <Snackbar
        visible={snackbarMessage !== null}
        onDismiss={handleDismissSnackbar}
        duration={4000}
      >
        {snackbarMessage}
      </Snackbar>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    marginBottom: 16,
  },
  statusSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  premiumStatus: {
    alignItems: 'center',
  },
  creditsStatus: {
    alignItems: 'center',
  },
  statusText: {
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    textAlign: 'center',
    opacity: 0.7,
  },
  featuresTitle: {
    marginBottom: 16,
    textAlign: 'center',
  },
  featuresList: {
    gap: 12,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  buttonContainer: {
    marginTop: 16,
    gap: 16,
  },
  actionButton: {},
  restoreButton: {
    marginBottom: 10,
  },
  purchaseLegalContainer: {
    marginTop: 4,
    alignItems: 'center',
    gap: 4,
  },
  purchaseLegalText: {
    textAlign: 'center',
    opacity: 0.75,
  },
  purchaseLegalLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  legalCardContent: {
    paddingHorizontal: 0,
  },
})
