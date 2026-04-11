import { useRouter } from 'expo-router'
import { useNavigation } from '@react-navigation/native'
import React, { useState } from 'react'
import { ScrollView, StyleSheet, View, Platform, Linking } from 'react-native'
import { Card, Text, IconButton, Button, Snackbar, List, Divider } from 'react-native-paper'
import { useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@xstate/react'

import CreditsDisplay from '~/components/CreditsDisplay'
import { useIsPremium } from '~/hooks/useIsPremium'
import { useUserPrivateData, userKeys } from '~/hooks/useUser'
import { useAuthMachine } from '~/hooks/useMachines'
import { makePackagePurchase, type ProductType } from '~/utilities/makePackagePurchase'
import { restorePurchases } from '~/config/revenueCatConfig'
import { supabaseClient } from '~/config/supabaseClient'

const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'

export default function SubscribeScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const queryClient = useQueryClient()
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)
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
      // Invalidate to ensure all components pick up fresh data
      await queryClient.invalidateQueries({ queryKey: userKeys.private(user?.uid) })
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
      await supabaseClient.auth.refreshSession()
      // Invalidate to ensure all components pick up fresh data
      await queryClient.invalidateQueries({ queryKey: userKeys.private(user?.uid) })
    } catch (e) {
      console.error('Restore failed:', e)
      setErrorMessage('Restore failed. Please try again.')
    } finally {
      setInFlightAction(null)
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.card}>
          <Card.Content>
            <View style={styles.statusSection}>
              <Text variant="headlineMedium" style={styles.title}>
                {isPremium ? 'Premium Account' : 'Upgrade to Premium'}
              </Text>

              {isPremium ? (
                <View style={styles.premiumStatus}>
                  <IconButton icon="crown" size={48} iconColor="#FFD700" />
                  <Text variant="bodyLarge" style={styles.statusText}>
                    You have unlimited access to all features!
                  </Text>
                </View>
              ) : Platform.OS !== 'web' ? (
                <View style={styles.creditsStatus}>
                  <Text variant="bodyLarge" style={styles.statusText}>
                    Current Credits: {credits}
                  </Text>
                  <Text variant="bodyMedium" style={styles.description}>
                    Credits are used for generating character images and other premium features.
                  </Text>
                </View>
              ) : null}
            </View>
          </Card.Content>
        </Card>

        {Platform.OS === 'web' ? (
          <CreditsDisplay />
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
                Unlimited Subscription - $20/Month
              </Button>
            )}
            <Button
              mode="outlined"
              onPress={() => handlePurchase('payg')}
              disabled={inFlightAction !== null}
              loading={inFlightAction === 'payg'}
              style={styles.actionButton}
            >
              Buy 100 Credits - $10
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
            <View style={styles.purchaseLegalContainer}>
              <Text variant="bodySmall" style={styles.purchaseLegalText}>
                By subscribing, you agree to the Terms of Use. Auto-renewable subscriptions are billed
                through Apple App Store. Apple Standard EULA applies.
              </Text>
              <View style={styles.purchaseLegalLinksRow}>
                <Button compact mode="text" onPress={() => router.push('/terms')}>
                  Terms of Use
                </Button>
                <Button compact mode="text" onPress={() => router.push('/privacy')}>
                  Privacy Policy
                </Button>
                <Button compact mode="text" onPress={() => Linking.openURL(APPLE_EULA_URL)}>
                  Apple EULA
                </Button>
              </View>
            </View>
          </View>
        )}

        {!isPremium && (
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="headlineSmall" style={styles.featuresTitle}>
                Premium Features
              </Text>

              <View style={styles.featuresList}>
                <View style={styles.feature}>
                  <IconButton icon="image" size={24} />
                  <Text variant="bodyMedium">Unlimited character image generation</Text>
                </View>

                <View style={styles.feature}>
                  <IconButton icon="message" size={24} />
                  <Text variant="bodyMedium">Enhanced chat capabilities</Text>
                </View>

                <View style={styles.feature}>
                  <IconButton icon="account-group" size={24} />
                  <Text variant="bodyMedium">Create unlimited characters</Text>
                </View>

                <View style={styles.feature}>
                  <IconButton icon="star" size={24} />
                  <Text variant="bodyMedium">Priority support</Text>
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
              <Text variant="bodyMedium">• Unlimited Subscription: $20/month</Text>
              <Text variant="bodyMedium">• One-time: 100 credits for $10</Text>
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
          </Card.Content>
        </Card>
      </ScrollView>

      <Snackbar
        visible={errorMessage !== null}
        onDismiss={() => setErrorMessage(null)}
        duration={4000}
      >
        {errorMessage}
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
