import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { ReactNode } from "react"
import { Provider as PaperProvider, DefaultTheme } from "react-native-paper"
//import { AlertsProvider } from "react-native-paper-alerts"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from "react-query"

import useCachedResources from "./app/hooks/useCachedResources"
import Navigation from "./app/navigation"
//import { ErrorBoundary } from "./app/screens/ErrorScreen/ErrorBoundary"
import { CustomDefaultTheme } from "./app/theme"

type PaperProviderProps = {
  children: ReactNode
  theme?: typeof DefaultTheme
}

type AlertsProviderProps = {
  children: ReactNode
}

const queryClient = new QueryClient()

export default function App() {
  const isLoadingComplete = useCachedResources()

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <PaperProvider theme={CustomDefaultTheme} {...(null as any as PaperProviderProps)}>
            {/*<AlertsProvider {...(null as any as AlertsProviderProps)}>*/}
            {/*<ErrorBoundary catchErrors="always">*/}
            <Navigation theme={CustomDefaultTheme} />
            <StatusBar />
            {/*</ErrorBoundary>*/}
            {/*</AlertsProvider>*/}
          </PaperProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    )
  }
}
