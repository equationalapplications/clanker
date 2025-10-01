import { Stack, useRouter } from "expo-router"
import React, { useEffect } from "react"
import { View } from "react-native"
import { ActivityIndicator } from "react-native-paper"
import { useAuth } from "../../src/hooks/useAuth"

export default function PrivateLayout() {
    const { firebaseUser, supabaseUser, isLoading } = useAuth()
    const router = useRouter()
    const authed = !!firebaseUser && !!supabaseUser

    useEffect(() => {
        if (!isLoading && !authed) {
            router.replace("/sign-in")
        } else if (!isLoading && authed) {
            // If user becomes authenticated, redirect to characters
            router.replace("/(private)")
        }
    }, [isLoading, authed, router])

    if (isLoading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" />
            </View>
        )
    }

    if (!authed) {
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
