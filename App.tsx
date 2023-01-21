import { StatusBar } from "expo-status-bar"
import { SafeAreaProvider } from "react-native-safe-area-context"

import useCachedResources from "./hooks/useCachedResources"
import useColorScheme from "./hooks/useColorScheme"
import Navigation from "./navigation"

export default function App() {
  const isLoadingComplete = useCachedResources()
  const colorScheme = useColorScheme()

  if (!isLoadingComplete) {
    return null
  } else {
    return (
      <SafeAreaProvider>
        <Navigation colorScheme={colorScheme} />
        <StatusBar />
      </SafeAreaProvider>
    )
  }
}

/*import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StatusBar } from "expo-status-bar"
import { StyleSheet } from "react-native"
import { Provider as PaperProvider } from "react-native-paper"
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import { AlertsProvider } from 'react-native-paper-alerts';

import { theme } from "./app/core/theme"
import RootNavigator from "./app/navigation/RootNavigator"

const queryClient = new QueryClient()

export default function App() {
  return (
    <SafeAreaProvider style={styles.container} initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={theme}>
          <AlertsProvider>
            <RootNavigator />
            <StatusBar style="auto" />
          </AlertsProvider>
        </PaperProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
})
*/
