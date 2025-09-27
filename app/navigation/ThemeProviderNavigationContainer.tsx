import AsyncStorage from "expo-sqlite/kv-store"
import {
  NavigationContainer,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from "@react-navigation/native"
import * as Linking from "expo-linking"
import { useEffect, useState } from "react"
import { useColorScheme } from "react-native"
import {
  Provider as PaperProvider,
  adaptNavigationTheme,
  MD3DarkTheme,
  MD3LightTheme,
} from "react-native-paper"

import { linkingConfig } from "./linkingConfig"
import { colorsLight, colorsDark, platform } from "../config/constants"

const PERSISTENCE_KEY = "NAVIGATION_STATE_V1"

const { LightTheme, DarkTheme } = adaptNavigationTheme({
  reactNavigationLight: NavigationDefaultTheme,
  reactNavigationDark: NavigationDarkTheme,
})

// Paper (MD3) themes with your custom color tokens
const PaperLightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...colorsLight,
  },
}

const PaperDarkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...colorsDark,
  },
}

export const ThemeProviderNavigationContainer = ({ children }) => {
  const [isReady, setIsReady] = useState(false)
  const [initialState, setInitialState] = useState()
  const deviceTheme = useColorScheme()

  // Derive themes per render to avoid type mismatches between providers
  const paperTheme = deviceTheme === "dark" ? PaperDarkTheme : PaperLightTheme
  const navTheme = deviceTheme === "dark" ? DarkTheme : LightTheme

  useEffect(() => {
    const restoreState = async () => {
      try {
        const initialUrl = await Linking.getInitialURL()

        if (platform !== "web" && initialUrl == null) {
          // Only restore state if there's no deep link and we're not on web
          const savedStateString = await AsyncStorage.getItem(PERSISTENCE_KEY)
          const state = savedStateString ? JSON.parse(savedStateString) : undefined

          if (state !== undefined) {
            setInitialState(state)
          }
        }
      } finally {
        setIsReady(true)
      }
    }

    if (!isReady) {
      restoreState()
    }
  }, [isReady])

  if (!isReady) {
    return null
  }

  return (
    <PaperProvider theme={paperTheme}>
      <NavigationContainer
        initialState={initialState}
        onStateChange={(state) => AsyncStorage.setItem(PERSISTENCE_KEY, JSON.stringify(state))}
        linking={linkingConfig}
        theme={navTheme}
      >
        {children}
      </NavigationContainer>
    </PaperProvider>
  )
}
