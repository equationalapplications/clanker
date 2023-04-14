import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"

import { SettingsStackParamList } from "./types"
import Profile from "../screens/Profile"
import Settings from "../screens/Settings"

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator>
      <SettingsStack.Screen
        name="Settings"
        component={Settings}
        options={{ headerShown: false, title: "Settings" }}
      />
      <SettingsStack.Screen
        name="Profile"
        component={Profile}
        options={{ headerShown: false, title: "Edit Character" }}
      />
    </SettingsStack.Navigator>
  )
}
