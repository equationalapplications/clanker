import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { ReactNode } from "react"
import ErrorBoundary from "react-native-error-boundary"
import { Provider as PaperProvider, DefaultTheme } from "react-native-paper"
import { AlertsProvider } from "react-native-paper-alerts"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import useCachedResources from "./app/hooks/useCachedResources"
import Navigation from "./app/navigation"
import { CustomDefaultTheme } from "./app/theme"

type PaperProviderProps = {
  children: ReactNode
  theme?: typeof DefaultTheme
}

type AlertsProviderProps = {
  children: ReactNode
}

export default function App() {
  const isLoadingComplete = useCachedResources()

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <ErrorBoundary>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <PaperProvider theme={CustomDefaultTheme} {...(null as any as PaperProviderProps)}>
            <AlertsProvider {...(null as any as AlertsProviderProps)}>
              <Navigation theme={CustomDefaultTheme} />
              <StatusBar />
            </AlertsProvider>
          </PaperProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    )
  }
}
