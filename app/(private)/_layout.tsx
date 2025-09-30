import { Redirect, Slot } from "expo-router"
import React from "react"
import { View } from "react-native"
import { ActivityIndicator } from "react-native-paper"
import { useAuth } from "../../src/hooks/useAuth"

export default function PrivateLayout() {
    const { firebaseUser, supabaseUser, isLoading } = useAuth()
    const authed = !!firebaseUser && !!supabaseUser

    if (isLoading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" />
            </View>
        )
    }

    if (!isLoading && !authed) {
        return <Redirect href="/sign-in" />
    }

    return <Slot />
}
