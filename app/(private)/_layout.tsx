import { Stack, useRouter } from "expo-router"
import React, { useEffect } from "react"
import { View } from "react-native"
import { ActivityIndicator } from "react-native-paper"
import { useAuth } from "../../src/hooks/useAuth"

export default function PrivateLayout() {
    const { user, isLoading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!isLoading && !user) {
            router.replace("/sign-in")
        } else if (!isLoading && user) {
            // If user becomes authenticated, redirect to characters
            router.replace("/(private)")
        }
    }, [isLoading, user, router])

    if (isLoading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" />
            </View>
        )
    }

    if (!user) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" />
            </View>
        )
    }

    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
    )
}
