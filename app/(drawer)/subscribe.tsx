import { useRouter } from 'expo-router'
import React, { useState } from 'react'
import { ScrollView, StyleSheet, View, Platform } from 'react-native'
import { Appbar, Card, Text, IconButton, Button } from 'react-native-paper'

import CreditsDisplay from '~/components/CreditsDisplay'
import { useIsPremium } from '~/hooks/useIsPremium'
import { useUserPrivateData } from '~/hooks/useUser'
import { makePackagePurchase, type ProductType } from '~/utilities/makePackagePurchase'
import { restorePurchases } from '~/config/revenueCatConfig'
import { supabaseClient } from '~/config/supabaseClient'

export default function SubscribeScreen() {
  const router = useRouter()
  const isPremium = useIsPremium()
  const { userPrivate } = useUserPrivateData()
  const credits = userPrivate?.credits || 0
  const [isLoading, setIsLoading] = useState(false)

  const handlePurchase = async (productType: Extract<ProductType, 'monthly_20' | 'payg'>) => {
    setIsLoading(true)
    try {
      await makePackagePurchase(productType)
    } catch (e) {
      console.error('Purchase failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestore = async () => {
    setIsLoading(true)
    try {
      await restorePurchases()
      await supabaseClient.auth.refreshSession()
    } catch (e) {
      console.error('Restore failed:', e)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="Subscription" />
      </Appbar.Header>

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
              ) : (
                <View style={styles.creditsStatus}>
                  <Text variant="bodyLarge" style={styles.statusText}>
                    Current Credits: {credits}
                  </Text>
                  <Text variant="bodyMedium" style={styles.description}>
                    Credits are used for generating character images and other premium features.
                  </Text>
                </View>
              )}
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
                disabled={isLoading}
                loading={isLoading}
                style={styles.actionButton}
              >
                Unlimited Subscription - $20/Month
              </Button>
            )}
            <Button
              mode="outlined"
              onPress={() => handlePurchase('payg')}
              disabled={isLoading}
              loading={isLoading}
              style={styles.actionButton}
            >
              Buy 100 Credits - $10
            </Button>
            <Button
              mode="text"
              onPress={handleRestore}
              disabled={isLoading}
              style={styles.restoreButton}
            >
              Restore Purchases
            </Button>
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
      </ScrollView>
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
    marginTop: 24,
    gap: 8,
  },
  actionButton: {},
  restoreButton: {
    marginTop: 4,
  },
})
