import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { Provider as PaperProvider } from "react-native-paper"
import { AlertsProvider } from "react-native-paper-alerts"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from "react-query"

import useCachedResources from "./app/hooks/useCachedResources"
import useColorScheme from "./app/hooks/useColorScheme"
import Navigation from "./app/navigation"
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
              <Navigation colorScheme={colorScheme} />
              <StatusBar />
            </AlertsProvider>
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    )
  }
}
