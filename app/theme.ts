import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from "@react-navigation/native"
import { adaptNavigationTheme, MD3DarkTheme, MD3LightTheme } from "react-native-paper"

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
  },
}
const CombinedDarkTheme = {
  ...MD3DarkTheme,
  ...DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    ...DarkTheme.colors,
  },
}

export const CustomDefaultTheme = {
  ...CombinedDefaultTheme,
  colors: {
    primary: "rgb(131, 84, 0)",
    onPrimary: "rgb(255, 255, 255)",
    primaryContainer: "rgb(255, 221, 181)",
    onPrimaryContainer: "rgb(42, 24, 0)",
    secondary: "rgb(112, 91, 64)",
    onSecondary: "rgb(255, 255, 255)",
    secondaryContainer: "rgb(251, 222, 188)",
    onSecondaryContainer: "rgb(39, 25, 5)",
    tertiary: "rgb(82, 100, 63)",
    onTertiary: "rgb(255, 255, 255)",
    tertiaryContainer: "rgb(213, 234, 186)",
    onTertiaryContainer: "rgb(17, 31, 3)",
    error: "rgb(186, 26, 26)",
    onError: "rgb(255, 255, 255)",
    errorContainer: "rgb(255, 218, 214)",
    onErrorContainer: "rgb(65, 0, 2)",
    background: "rgb(255, 251, 255)",
    onBackground: "rgb(31, 27, 22)",
    surface: "rgb(255, 251, 255)",
    onSurface: "rgb(31, 27, 22)",
    surfaceVariant: "rgb(240, 224, 208)",
    onSurfaceVariant: "rgb(79, 69, 57)",
    outline: "rgb(129, 117, 104)",
    outlineVariant: "rgb(211, 196, 180)",
    shadow: "rgb(0, 0, 0)",
    scrim: "rgb(0, 0, 0)",
    inverseSurface: "rgb(53, 48, 42)",
    inverseOnSurface: "rgb(249, 239, 231)",
    inversePrimary: "rgb(255, 185, 87)",
    elevation: {
      level0: "transparent",
      level1: "rgb(249, 243, 242)",
      level2: "rgb(245, 238, 235)",
      level3: "rgb(241, 233, 227)",
      level4: "rgb(240, 231, 224)",
      level5: "rgb(238, 228, 219)",
    },
    surfaceDisabled: "rgba(31, 27, 22, 0.12)",
    onSurfaceDisabled: "rgba(31, 27, 22, 0.38)",
    backdrop: "rgba(56, 47, 36, 0.4)",
  },
}

export const CustomDarkTheme = {
  ...CombinedDarkTheme,
  colors: {
    colors: {
      primary: "rgb(255, 185, 87)",
      onPrimary: "rgb(70, 43, 0)",
      primaryContainer: "rgb(100, 63, 0)",
      onPrimaryContainer: "rgb(255, 221, 181)",
      secondary: "rgb(222, 194, 162)",
      onSecondary: "rgb(62, 45, 22)",
      secondaryContainer: "rgb(87, 67, 43)",
      onSecondaryContainer: "rgb(251, 222, 188)",
      tertiary: "rgb(185, 205, 160)",
      onTertiary: "rgb(37, 53, 20)",
      tertiaryContainer: "rgb(59, 76, 41)",
      onTertiaryContainer: "rgb(213, 234, 186)",
      error: "rgb(255, 180, 171)",
      onError: "rgb(105, 0, 5)",
      errorContainer: "rgb(147, 0, 10)",
      onErrorContainer: "rgb(255, 180, 171)",
      background: "rgb(31, 27, 22)",
      onBackground: "rgb(235, 225, 217)",
      surface: "rgb(31, 27, 22)",
      onSurface: "rgb(235, 225, 217)",
      surfaceVariant: "rgb(79, 69, 57)",
      onSurfaceVariant: "rgb(211, 196, 180)",
      outline: "rgb(156, 142, 128)",
      outlineVariant: "rgb(79, 69, 57)",
      shadow: "rgb(0, 0, 0)",
      scrim: "rgb(0, 0, 0)",
      inverseSurface: "rgb(235, 225, 217)",
      inverseOnSurface: "rgb(53, 48, 42)",
      inversePrimary: "rgb(131, 84, 0)",
      elevation: {
        level0: "transparent",
        level1: "rgb(42, 35, 25)",
        level2: "rgb(49, 40, 27)",
        level3: "rgb(56, 44, 29)",
        level4: "rgb(58, 46, 30)",
        level5: "rgb(62, 49, 31)",
      },
      surfaceDisabled: "rgba(235, 225, 217, 0.12)",
      onSurfaceDisabled: "rgba(235, 225, 217, 0.38)",
      backdrop: "rgba(56, 47, 36, 0.4)",
    },
  },
}
