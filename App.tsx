import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
//import { ReactNode } from "react"
import ErrorBoundary from "react-native-error-boundary"
//import { Provider as PaperProvider, DefaultTheme } from "react-native-paper"
//import { AlertsProvider } from "react-native-paper-alerts"
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context"

import useCachedResources from "./app/hooks/useCachedResources"
//import Navigation from "./app/navigation"
import RootNavigator from "./app/navigation/RootNavigator"
//import { CustomDefaultTheme } from "./app/theme"
import ThemeProvider from "./app/providers/ThemeProvider"

//type PaperProviderProps = {
//  children: ReactNode
//  theme?: typeof DefaultTheme
//}

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
            {/*<PaperProvider theme={CustomDefaultTheme} {...(null as any as PaperProviderProps)}>*/}
            {/*<AlertsProvider >*/}
            {/*<Navigation theme={CustomDefaultTheme} />*/}
            <RootNavigator />
            <StatusBar />
            {/*</AlertsProvider>*/}
            {/*</PaperProvider>*/}
          </ThemeProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    )
  }
}
