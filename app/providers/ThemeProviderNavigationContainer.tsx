import {
  NavigationContainer,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from "@react-navigation/native"
import React, { useEffect, useState } from "react"
import { useColorScheme } from "react-native"
import {
  Provider as PaperProvider,
  adaptNavigationTheme,
  MD3DarkTheme,
  MD3LightTheme,
} from "react-native-paper"

import { colorsLight, colorsDark } from "../config/constants"
import LinkingConfiguration from "../navigation/LinkingConfiguration"

const { LightTheme, DarkTheme } = adaptNavigationTheme({
  reactNavigationLight: NavigationDefaultTheme,
  reactNavigationDark: NavigationDarkTheme,
})

const CombinedDefaultTheme = {
  ...MD3LightTheme,
  ...LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...LightTheme.colors,
    ...colorsLight,
  },
}

const CombinedDarkTheme = {
  ...MD3DarkTheme,
  ...DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...DarkTheme.colors,
    ...colorsDark,
  },
}

export const ThemeProviderNavigationContainer = ({ children }) => {
  const deviceTheme = useColorScheme()

  const [theme, setTheme] = useState(
    deviceTheme === "dark" ? CombinedDarkTheme : CombinedDefaultTheme,
  )

  useEffect(() => {
    if (deviceTheme === "dark") {
      setTheme(CombinedDarkTheme)
    } else {
      setTheme(CombinedDefaultTheme)
    }
  }, [deviceTheme])

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer linking={LinkingConfiguration} theme={theme}>
        {children}
      </NavigationContainer>
    </PaperProvider>
  )
}
