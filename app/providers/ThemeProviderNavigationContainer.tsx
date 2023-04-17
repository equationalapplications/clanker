import {
  NavigationContainer,
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from "@react-navigation/native"
import { useEffect, useState } from "react"
import { useColorScheme, Linking } from "react-native"
import {
  Provider as PaperProvider,
  adaptNavigationTheme,
  MD3DarkTheme,
  MD3LightTheme,
} from "react-native-paper"
import AsyncStorage from '@react-native-async-storage/async-storage'

import { colorsLight, colorsDark, platform } from "../config/constants"
import LinkingConfiguration from "../navigation/LinkingConfiguration"

const PERSISTENCE_KEY = 'NAVIGATION_STATE_V1'

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
  const [isReady, setIsReady] = useState(false)
  const [initialState, setInitialState] = useState()
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

  useEffect(() => {
    const restoreState = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();

        if (platform !== 'web' && initialUrl == null) {
          // Only restore state if there's no deep link and we're not on web
          const savedStateString = await AsyncStorage.getItem(PERSISTENCE_KEY);
          const state = savedStateString ? JSON.parse(savedStateString) : undefined;

          if (state !== undefined) {
            setInitialState(state);
          }
        }
      } finally {
        setIsReady(true);
      }
    };

    if (!isReady) {
      restoreState();
    }
  }, [isReady])

  if (!isReady) {
    return null;
  }

  return (
    <PaperProvider theme={theme}>
      <NavigationContainer
        initialState={initialState}
        onStateChange={(state) =>
          AsyncStorage.setItem(PERSISTENCE_KEY, JSON.stringify(state))
        }
        linking={LinkingConfiguration}
        theme={theme}
      >
        {children}
      </NavigationContainer>
    </PaperProvider>
  )
}
