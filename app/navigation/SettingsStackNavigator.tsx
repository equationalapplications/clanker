import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"

import { SettingsStackParamList } from "./types"
import { CreditCounterIcon } from "../components/CreditCounterIcon"
import { TabBarIcon } from "../components/TabBarIcon"
import Profile from "../screens/Profile"
import Settings from "../screens/Settings"

const SettingsStack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator>
      <SettingsStack.Screen
        name="Settings"
        component={Settings}
        options={({ navigation }) => ({
          title: "Settings",
          tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
      <SettingsStack.Screen
        name="Profile"
        component={Profile}
        options={({ navigation }) => ({
          title: "Profile",
          tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
    </SettingsStack.Navigator>
  )
}
