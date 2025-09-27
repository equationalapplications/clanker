import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import ErrorBoundary from "react-native-error-boundary"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClientProvider } from "@tanstack/react-query"

import { CustomFallback } from "./app/components/CustomFallback"
import { queryClient } from "./app/config/queryClient"
import useCachedResources from "./app/hooks/useCachedResources"
import RootNavigator from "./app/navigation/RootNavigator"
import { ThemeProviderNavigationContainer } from "./app/navigation/ThemeProviderNavigationContainer"
import React from "react"

export default function App() {
  const isLoadingComplete = useCachedResources()

  if (!isLoadingComplete) {
    console.log("Loading...");
    return null

  } else {
    return (
      <ErrorBoundary FallbackComponent={CustomFallback}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <QueryClientProvider client={queryClient}>
            <ThemeProviderNavigationContainer>
              <RootNavigator />
              <StatusBar />
            </ThemeProviderNavigationContainer>
          </QueryClientProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    )
  }
}
