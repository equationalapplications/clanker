import { MD3DarkTheme, MD3LightTheme, MD3Theme } from 'react-native-paper'
import {
  DarkTheme as NavigationDarkThemeBase,
  DefaultTheme as NavigationDefaultThemeBase,
  Theme as NavigationTheme,
} from '@react-navigation/native'
import { colorsLight, colorsDark } from './constants'

// Map app constants to MD3 theme colors.
const lightColors: Partial<MD3Theme['colors']> = {
  primary: colorsLight.primary,
  onPrimary: colorsLight.onPrimary,
  primaryContainer: colorsLight.primaryContainer,
  onPrimaryContainer: colorsLight.onPrimaryContainer,
  secondary: colorsLight.secondary,
  onSecondary: colorsLight.onSecondary,
  secondaryContainer: colorsLight.secondaryContainer,
  onSecondaryContainer: colorsLight.onSecondaryContainer,
  tertiary: colorsLight.tertiary,
  onTertiary: colorsLight.onTertiary,
  tertiaryContainer: colorsLight.tertiaryContainer,
  onTertiaryContainer: colorsLight.onTertiaryContainer,
  error: colorsLight.error,
  onError: colorsLight.onError,
  errorContainer: colorsLight.errorContainer,
  onErrorContainer: colorsLight.onErrorContainer,
  background: colorsLight.background,
  onBackground: colorsLight.onBackground,
  surface: colorsLight.surface,
  onSurface: colorsLight.onSurface,
  surfaceVariant: colorsLight.surfaceVariant,
  onSurfaceVariant: colorsLight.onSurfaceVariant,
  outline: colorsLight.outline,
  outlineVariant: colorsLight.outlineVariant,
  shadow: colorsLight.shadow,
  scrim: colorsLight.scrim,
  inverseSurface: colorsLight.inverseSurface,
  inverseOnSurface: colorsLight.inverseOnSurface,
  inversePrimary: colorsLight.inversePrimary,
  elevation: colorsLight.elevation as any,
  surfaceDisabled: colorsLight.surfaceDisabled as any,
  onSurfaceDisabled: colorsLight.onSurfaceDisabled as any,
  backdrop: colorsLight.backdrop,
}

const darkColors: Partial<MD3Theme['colors']> = {
  primary: colorsDark.primary,
  onPrimary: colorsDark.onPrimary,
  primaryContainer: colorsDark.primaryContainer,
  onPrimaryContainer: colorsDark.onPrimaryContainer,
  secondary: colorsDark.secondary,
  onSecondary: colorsDark.onSecondary,
  secondaryContainer: colorsDark.secondaryContainer,
  onSecondaryContainer: colorsDark.onSecondaryContainer,
  tertiary: colorsDark.tertiary,
  onTertiary: colorsDark.onTertiary,
  tertiaryContainer: colorsDark.tertiaryContainer,
  onTertiaryContainer: colorsDark.onTertiaryContainer,
  error: colorsDark.error,
  onError: colorsDark.onError,
  errorContainer: colorsDark.errorContainer,
  onErrorContainer: colorsDark.onErrorContainer,
  background: colorsDark.background,
  onBackground: colorsDark.onBackground,
  surface: colorsDark.surface,
  onSurface: colorsDark.onSurface,
  surfaceVariant: colorsDark.surfaceVariant,
  onSurfaceVariant: colorsDark.onSurfaceVariant,
  outline: colorsDark.outline,
  outlineVariant: colorsDark.outlineVariant,
  shadow: colorsDark.shadow,
  scrim: colorsDark.scrim,
  inverseSurface: colorsDark.inverseSurface,
  inverseOnSurface: colorsDark.inverseOnSurface,
  inversePrimary: colorsDark.inversePrimary,
  elevation: colorsDark.elevation as any,
  surfaceDisabled: colorsDark.surfaceDisabled as any,
  onSurfaceDisabled: colorsDark.onSurfaceDisabled as any,
  backdrop: colorsDark.backdrop,
}

export const appLightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    ...lightColors,
  },
}

export const appDarkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...darkColors,
  },
}

// React Navigation themes derived from our Paper themes
export const appNavigationLightTheme: NavigationTheme = {
  ...NavigationDefaultThemeBase,
  colors: {
    ...NavigationDefaultThemeBase.colors,
    primary: appLightTheme.colors.primary,
    background: appLightTheme.colors.background,
    card: appLightTheme.colors.surface,
    text: appLightTheme.colors.onSurface,
    border: appLightTheme.colors.outline,
    notification: appLightTheme.colors.secondary ?? appLightTheme.colors.primary,
  },
}

export const appNavigationDarkTheme: NavigationTheme = {
  ...NavigationDarkThemeBase,
  colors: {
    ...NavigationDarkThemeBase.colors,
    primary: appDarkTheme.colors.primary,
    background: appDarkTheme.colors.background,
    card: appDarkTheme.colors.surface,
    text: appDarkTheme.colors.onSurface,
    border: appDarkTheme.colors.outline,
    notification: appDarkTheme.colors.secondary ?? appDarkTheme.colors.primary,
  },
}
