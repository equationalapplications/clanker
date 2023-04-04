import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import ErrorBoundary from "react-native-error-boundary"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClientProvider, QueryClient } from "react-query"

import useCachedResources from "./app/hooks/useCachedResources"
import RootNavigator from "./app/navigation/RootNavigator"
import ThemeProvider from "./app/providers/ThemeProvider"

const queryClient = new QueryClient()

export default function App() {
  const isLoadingComplete = useCachedResources()

  const onError = (error: Error, stackTrace: string) => {
    console.log("Error: ", error)
    console.log("Stack trace: ", stackTrace)
  }

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <ErrorBoundary onError={onError}>
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
