import { StatusBar } from "expo-status-bar"
import { StyleSheet, View } from "react-native"
import { Provider as PaperProvider } from "react-native-paper"

import "expo-dev-client"
import Entry from "./app/Entry"

export default function App() {
  return (
    <PaperProvider>
      <View style={styles.container}>
        <Entry />
        <StatusBar style="auto" />
      </View>
    </PaperProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
})
