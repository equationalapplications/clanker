import "expo-dev-client"
import { StatusBar } from "expo-status-bar"
import { StyleSheet } from "react-native"
import { Provider as PaperProvider } from "react-native-paper"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { theme } from "./app/core/theme"
import RootNavigator from "./app/navigation/RootNavigator"

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PaperProvider theme={theme}>
        <SafeAreaProvider style={styles.container}>
          <RootNavigator />
          <StatusBar style="auto" />
        </SafeAreaProvider>
      </PaperProvider>
    </QueryClientProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
})
