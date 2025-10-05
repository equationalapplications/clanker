import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { useColorScheme, View, StyleSheet } from "react-native"
import { QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { ThemeProvider as NavigationThemeProvider } from "@react-navigation/native"

// import ErrorBoundary from "react-native-error-boundary"
// import { CustomFallback } from "../src/components/CustomFallback"
import { ThemeProvider } from "../src/components/ThemeProvider"
import { AuthProvider, useAuth } from "../src/hooks/useAuth"
import { queryClient } from "../src/config/queryClient"
import { appNavigationDarkTheme, appNavigationLightTheme } from "../src/config/theme"
import LoadingIndicator from "../src/components/LoadingIndicator"
import useCachedResources from "../src/hooks/useCachedResources"

function StackNavigator() {
    const { user, isLoading } = useAuth()

    console.log('🔐 StackNavigator render - user:', !!user, 'isLoading:', isLoading, 'timestamp:', Date.now())

    // Show loading indicator instead of blank screen while loading
    if (isLoading) {
        console.log('⏳ Showing loading screen because isLoading =', isLoading)
        return (
            <View style={styles.loadingContainer}>
                <LoadingIndicator disabled={false} />
            </View>
        )
    }

    const isLoggedIn = !!user
    console.log('🚦 Auth resolved - isLoggedIn:', isLoggedIn, 'about to render Stack with routes')

    return (
        <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            {/* Protected routes - only available when logged in */}
            <Stack.Protected guard={isLoggedIn}>
                <Stack.Screen name="(root)" options={{ headerShown: false }} />
                <Stack.Screen name="subscribe" options={{ presentation: "modal" }} />
            </Stack.Protected>

            {/* Public routes - only available when NOT logged in */}
            <Stack.Protected guard={!isLoggedIn}>
                <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            </Stack.Protected>

            {/* Modal routes - always available */}
            <Stack.Screen name="accept-terms" options={{ presentation: "modal", headerShown: false }} />

            {/* Info pages - always available */}
            <Stack.Screen name="privacy" options={{ headerShown: false }} />
            <Stack.Screen name="terms" options={{ headerShown: false }} />
        </Stack>
    )
}

export default function RootLayout() {
    const scheme = useColorScheme()
    const navTheme = scheme === "dark" ? appNavigationDarkTheme : appNavigationLightTheme
    const isLoadingComplete = useCachedResources()

    if (!isLoadingComplete) {
        return (
            <View style={styles.loadingContainer}>
                <LoadingIndicator disabled={false} />
            </View>
        )
    }

    return (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <ThemeProvider>
                        <NavigationThemeProvider value={navTheme}>
                            <StackNavigator />
                        </NavigationThemeProvider>
                        <StatusBar />
                    </ThemeProvider>
                </AuthProvider>
            </QueryClientProvider>
        </SafeAreaProvider>
    )
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
})