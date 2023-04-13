import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import ErrorBoundary from "react-native-error-boundary"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClientProvider } from "react-query"

import { CustomFallback } from "./app/components/CustomFallback"
import { queryClient } from "./app/config/queryClient"
import useCachedResources from "./app/hooks/useCachedResources"
import RootNavigator from "./app/navigation/RootNavigator"
import ThemeProvider from "./app/providers/ThemeProvider"

export default function App() {
  const isLoadingComplete = useCachedResources()

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <ErrorBoundary FallbackComponent={CustomFallback}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <RootNavigator />
              <StatusBar />
            </QueryClientProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    )
  }
}
