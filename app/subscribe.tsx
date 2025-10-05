import { useRouter } from "expo-router"
import React, { useState } from "react"
import { ScrollView, StyleSheet, View } from "react-native"
import { Appbar, Card, Text, IconButton } from "react-native-paper"

import CombinedSubscriptionButton from "~/components/CombinedSubscriptionButton"
import LoadingIndicator from "~/components/LoadingIndicator"
import { useIsPremium } from "~/hooks/useIsPremium"
import { useUserPrivate } from "~/hooks/useUserPrivate"

export default function SubscribeScreen() {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(false)
    const isPremium = useIsPremium()
    const userPrivate = useUserPrivate()
    const credits = userPrivate?.credits || 0

    const onChangeIsLoading = (loading: boolean) => {
        setIsLoading(loading)
    }

    if (isLoading) {
        return <LoadingIndicator />
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
                                {isPremium ? "Premium Account" : "Upgrade to Premium"}
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

                <View style={styles.buttonContainer}>
                    <CombinedSubscriptionButton onChangeIsLoading={onChangeIsLoading} />
                </View>
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
        alignItems: "center",
        marginBottom: 16,
    },
    title: {
        textAlign: "center",
        marginBottom: 16,
    },
    premiumStatus: {
        alignItems: "center",
    },
    creditsStatus: {
        alignItems: "center",
    },
    statusText: {
        textAlign: "center",
        marginBottom: 8,
    },
    description: {
        textAlign: "center",
        opacity: 0.7,
    },
    featuresTitle: {
        marginBottom: 16,
        textAlign: "center",
    },
    featuresList: {
        gap: 12,
    },
    feature: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
    },
    buttonContainer: {
        marginTop: 24,
        alignItems: "center",
    },
})