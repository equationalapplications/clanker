import React from 'react'
import { Provider as PaperProvider } from 'react-native-paper'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { ThemeProvider as NavigationThemeProvider } from '@react-navigation/native'
import { appDarkTheme, appLightTheme, appNavigationDarkTheme, appNavigationLightTheme } from '~/config/theme'
import { useSettings } from '~/contexts/SettingsContext'

interface ThemeProviderProps {
  children: React.ReactNode
}

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const { settings } = useSettings()
  const isDark = settings.darkMode
  const paperTheme = isDark ? appDarkTheme : appLightTheme
  const navigationTheme = isDark ? appNavigationDarkTheme : appNavigationLightTheme

  return (
    <PaperProvider
      theme={paperTheme}
      settings={{
        icon: (props) => <MaterialCommunityIcons {...props} />, // web-safe icon mapping
      }}
    >
      <NavigationThemeProvider value={navigationTheme}>
        {children}
      </NavigationThemeProvider>
    </PaperProvider>
  )
}
