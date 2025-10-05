/// <reference types="expo-router/types" />
import "expo-dev-client";
import { StatusBar } from "expo-status-bar";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme, View, StyleSheet } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider as NavigationThemeProvider } from "@react-navigation/native";
import { Stack } from 'expo-router';

import { ThemeProvider } from "~/components/ThemeProvider";
import { AuthProvider, useAuth } from "~/hooks/useAuth";
import { SubscriptionStatusProvider } from "~/hooks/useSubscriptionStatus";
import { queryClient } from "~/config/queryClient";
import { appNavigationDarkTheme, appNavigationLightTheme } from "~/config/theme";
import LoadingIndicator from "~/components/LoadingIndicator";
import useCachedResources from "~/hooks/useCachedResources";

// This component handles the core authentication logic using Stack.Protected
function RootLayoutNav() {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <LoadingIndicator disabled={false} />
            </View>
        );
    }

    const isLoggedIn = !!user;

    return (
        <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />

            {/* Protected routes - only available when logged in */}
            <Stack.Protected guard={isLoggedIn}>
                <Stack.Screen name="(app)" options={{ headerShown: false }} />
                <Stack.Screen name="subscribe" options={{ presentation: "modal" }} />
                <Stack.Screen name="accept-terms" options={{ presentation: "modal", headerShown: false }} />
            </Stack.Protected>

            {/* Public routes - only available when NOT logged in */}
            <Stack.Protected guard={!isLoggedIn}>
                <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            </Stack.Protected>

            {/* Info pages - always available */}
            <Stack.Screen name="privacy" options={{ headerShown: false }} />
            <Stack.Screen name="terms" options={{ headerShown: false }} />
        </Stack>
    );
}

export default function RootLayout() {
    const scheme = useColorScheme();
    const navTheme = scheme === "dark" ? appNavigationDarkTheme : appNavigationLightTheme;
    const isLoadingComplete = useCachedResources();

    if (!isLoadingComplete) {
        return (
            <View style={styles.loadingContainer}>
                <LoadingIndicator disabled={false} />
            </View>
        );
    }

    return (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <SubscriptionStatusProvider>
                        <ThemeProvider>
                            <NavigationThemeProvider value={navTheme}>
                                <RootLayoutNav />
                            </NavigationThemeProvider>
                            <StatusBar />
                        </ThemeProvider>
                    </SubscriptionStatusProvider>
                </AuthProvider>
            </QueryClientProvider>
        </SafeAreaProvider>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});