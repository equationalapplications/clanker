import React from "react"
import { useColorScheme } from "react-native"
import { Provider as PaperProvider } from "react-native-paper"
import { MaterialCommunityIcons } from "@expo/vector-icons"
import { appDarkTheme, appLightTheme } from "~/config/theme"

interface ThemeProviderProps {
  children: React.ReactNode
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const deviceTheme = useColorScheme()
  const paperTheme = deviceTheme === "dark" ? appDarkTheme : appLightTheme

  return (
    <PaperProvider
      theme={paperTheme}
      settings={{
        icon: (props) => <MaterialCommunityIcons {...props} />, // web-safe icon mapping
      }}
    >
      {children}
    </PaperProvider>
  )
}