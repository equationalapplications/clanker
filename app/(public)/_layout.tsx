import { Redirect, Stack, usePathname, useRouter } from "expo-router"
import React from "react"
import { View } from "react-native"
import { ActivityIndicator, IconButton } from "react-native-paper"
import { useAuth } from "../../src/hooks/useAuth"

export default function PublicLayout() {
    const { firebaseUser, supabaseUser, isLoading } = useAuth()
    const pathname = usePathname()
    const router = useRouter()
    const authed = !!firebaseUser && !!supabaseUser
    const isInfoPage = pathname?.endsWith("/terms") || pathname?.endsWith("/privacy")

    const handleClose = () => {
        if (router.canGoBack()) {
            router.back()
        } else {
            const isAuthed = !!firebaseUser && !!supabaseUser
            router.replace(isAuthed ? "/dashboard" : "/sign-in")
        }
    }

    if (isLoading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" />
            </View>
        )
    }

    if (!isLoading && authed && !isInfoPage) {
        return <Redirect href="/dashboard" />
    }

    return (
        <Stack>
            {/* Present info pages as modals for nicer native UX; web falls back to normal push */}
            <Stack.Screen
                name="terms"
                options={{
                    presentation: "modal",
                    headerShown: true,
                    title: "Terms of Service",
                    headerRight: () => (
                        <IconButton
                            icon="close"
                            onPress={handleClose}
                            accessibilityLabel="Close"
                            size={20}
                        />
                    )
                }}
            />
            <Stack.Screen
                name="privacy"
                options={{
                    presentation: "modal",
                    headerShown: true,
                    title: "Privacy Policy",
                    headerRight: () => (
                        <IconButton
                            icon="close"
                            onPress={handleClose}
                            accessibilityLabel="Close"
                            size={20}
                        />
                    )
                }}
            />
        </Stack>
    )
}
