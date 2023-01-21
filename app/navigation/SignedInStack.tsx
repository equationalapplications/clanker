import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs"
import { createStackNavigator } from "@react-navigation/stack"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useAppSettings } from "../components/AppSettings"
import { NotFound } from "../components/NotFound"
import Profile from "../screens/signed-in/Profile"
import Settings from "../screens/signed-in/Settings"

const Stack = createStackNavigator()
const TopTabs = createMaterialTopTabNavigator()

const ProfileStack = () => {
  const appSettings = useAppSettings()
  return (
    <Stack.Navigator initialRouteName="UserProfile">
      <Stack.Screen name="UserProfile" component={Profile} options={{ headerShown: false }} />
      <Stack.Screen
        name="UserSettings"
        options={{ title: appSettings.t("settings") }}
        component={Settings}
      />
      <Stack.Screen
        name="NotFound"
        component={NotFound}
        options={{ title: appSettings.t("NotFound") }}
      />
    </Stack.Navigator>
  )
}

const SignedInStack = () => {
  // Used for status bar layout in react-navigation
  const insets = useSafeAreaInsets()
  const appSettings = useAppSettings()

  const screenOptions = {
    tabBarStyle: {
      paddingTop: insets.top,
    },
  }

  return (
    <TopTabs.Navigator initialRouteName="Home" screenOptions={screenOptions}>
      <TopTabs.Screen
        name="User"
        options={{ title: appSettings.t("userInfo") }}
        component={ProfileStack}
      />
    </TopTabs.Navigator>
  )
}

export default SignedInStack
