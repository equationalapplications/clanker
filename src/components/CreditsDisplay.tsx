import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Card, Text, Button, Chip } from 'react-native-paper'
import { useUserCredits } from '~/hooks/useUserCredits'
import LoadingIndicator from '~/components/LoadingIndicator'

export default function CreditsDisplay() {
    const { data: credits, isLoading, error, refetch } = useUserCredits()

    if (isLoading) {
        return <LoadingIndicator />
    }

    if (error) {
        return (
            <Card style={styles.errorCard}>
                <Card.Content>
                    <Text variant="bodyMedium">Error loading credits</Text>
                    <Button onPress={() => refetch()} mode="outlined" style={styles.retryButton}>
                        Retry
                    </Button>
                </Card.Content>
            </Card>
        )
    }

    const handleBuyCredits = () => {
        // TODO: Implement Stripe payment for credits
        console.log('Buy credits clicked')
    }

    const handleSubscribe = () => {
        // TODO: Implement Stripe subscription
        console.log('Subscribe clicked')
    }

    return (
        <Card style={styles.card}>
            <Card.Content>
                <Text variant="headlineSmall" style={styles.title}>
                    Your Credits
                </Text>

                {credits?.hasUnlimited ? (
                    <View style={styles.unlimitedContainer}>
                        <Chip icon="infinity" mode="flat" style={styles.unlimitedChip}>
                            Unlimited Credits
                        </Chip>
                        <Text variant="bodyMedium" style={styles.description}>
                            You have unlimited credits with your subscription!
                        </Text>
                        {credits.totalCredits > 0 && (
                            <Text variant="bodySmall" style={styles.savedCredits}>
                                Plus {credits.totalCredits} saved credits for later
                            </Text>
                        )}
                    </View>
                ) : (
                    <View style={styles.creditsContainer}>
                        <Text variant="displaySmall" style={styles.creditsCount}>
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
                                {sub.tier === 'monthly_1000' && 'Monthly 1000 Credits'}
                                {sub.tier === 'monthly_unlimited' && 'Unlimited Plan'}
                                {sub.tier === 'credits_only' && 'Purchased Credits'}
                            </Text>
                            {!sub.isUnlimited && (
                                <Text variant="bodySmall" style={styles.creditsText}>
                                    {sub.credits} credits
                                </Text>
                            )}
                        </View>
                    ))}
                </View>

                <View style={styles.actionsContainer}>
                    <Button
                        mode="outlined"
                        onPress={handleBuyCredits}
                        style={styles.actionButton}
                    >
                        Buy 100 Credits ($3)
                    </Button>

                    <Button
                        mode="contained"
                        onPress={handleSubscribe}
                        style={styles.actionButton}
                    >
                        Subscribe
                    </Button>
                </View>

                <View style={styles.pricingInfo}>
                    <Text variant="bodySmall" style={styles.pricingText}>
                        • 1000 credits/month: $20
                    </Text>
                    <Text variant="bodySmall" style={styles.pricingText}>
                        • Unlimited credits: $50
                    </Text>
                    <Text variant="bodySmall" style={styles.pricingText}>
                        • One-time: 100 credits for $3
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
        backgroundColor: '#ffebee',
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
        backgroundColor: '#e8f5e8',
        marginBottom: 8,
    },
    description: {
        textAlign: 'center',
        marginBottom: 4,
    },
    savedCredits: {
        textAlign: 'center',
        color: '#666',
    },
    creditsContainer: {
        alignItems: 'center',
        marginBottom: 16,
    },
    creditsCount: {
        fontWeight: 'bold',
        color: '#2196F3',
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
    creditsText: {
        color: '#666',
    },
    actionsContainer: {
        gap: 8,
        marginBottom: 16,
    },
    actionButton: {
        marginVertical: 4,
    },
    pricingInfo: {
        borderTopWidth: 1,
        borderTopColor: '#eee',
        paddingTop: 12,
    },
    pricingText: {
        color: '#666',
        marginVertical: 2,
    },
    retryButton: {
        marginTop: 8,
    },
})