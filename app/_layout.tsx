import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { useColorScheme } from "react-native"
import { QueryClientProvider } from "@tanstack/react-query"
import { Stack } from "expo-router"
import { ThemeProvider as NavigationThemeProvider } from "@react-navigation/native"

// import ErrorBoundary from "react-native-error-boundary"
// import { CustomFallback } from "../src/components/CustomFallback"
import { ThemeProvider } from "../src/components/ThemeProvider"
import { AuthProvider } from "../src/hooks/useAuth"
import { queryClient } from "../src/config/queryClient"
import { appNavigationDarkTheme, appNavigationLightTheme } from "../src/config/theme"

export default function RootLayout() {
    const scheme = useColorScheme()
    const navTheme = scheme === "dark" ? appNavigationDarkTheme : appNavigationLightTheme
    return (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <ThemeProvider>
                        <NavigationThemeProvider value={navTheme}>
                            <Stack>
                                <Stack.Screen name="index" options={{ headerShown: false }} />
                                <Stack.Screen
                                    name="sign-in"
                                    options={{
                                        headerShown: false,
                                        title: "Sign In",
                                    }}
                                />
                                <Stack.Screen
                                    name="dashboard"
                                    options={{
                                        title: "Dashboard",
                                    }}
                                />
                                <Stack.Screen
                                    name="terms"
                                    options={{
                                        title: "Terms of Service",
                                        presentation: "modal",
                                    }}
                                />
                                <Stack.Screen
                                    name="privacy"
                                    options={{
                                        title: "Privacy Policy",
                                        presentation: "modal",
                                    }}
                                />
                            </Stack>
                        </NavigationThemeProvider>
                        <StatusBar />
                    </ThemeProvider>
                </AuthProvider>
            </QueryClientProvider>
        </SafeAreaProvider>
    )
}