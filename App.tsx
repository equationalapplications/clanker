import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { Provider as PaperProvider } from "react-native-paper"
import { AlertsProvider } from "react-native-paper-alerts"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from "react-query"

import useCachedResources from "./app/hooks/useCachedResources"
import useColorScheme from "./app/hooks/useColorScheme"
import Navigation from "./app/navigation"
import { ErrorBoundary } from "./app/screens/ErrorScreen/ErrorBoundary"
import { theme } from "./app/theme"

const queryClient = new QueryClient()

export default function App() {
  const isLoadingComplete = useCachedResources()
  const colorScheme = useColorScheme()

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={theme}>
            <AlertsProvider>
              <ErrorBoundary catchErrors="always">
                <Navigation colorScheme={colorScheme} />
                <StatusBar />
              </ErrorBoundary>
            </AlertsProvider>
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    )
  }
}
