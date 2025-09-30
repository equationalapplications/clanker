import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import React from "react"

import { CharacterStackNavigator } from "./CharacterStackNavigator"
import { SettingsStackNavigator } from "./SettingsStackNavigator"
import { BottomTabParamList, BottomTabScreenProps } from "./types"
import { CreditCounterIcon } from "../components/CreditCounterIcon"
import { TabBarIcon } from "../components/TabBarIcon"
import Chat from "../screens/Chat"

/**
 * A bottom tab navigator displays tab buttons on the bottom of the display to switch screens.
 * https://reactnavigation.org/docs/bottom-tab-navigator
 */
const BottomTab = createBottomTabNavigator<BottomTabParamList>()

export function BottomTabNavigator() {
  return (
    <BottomTab.Navigator initialRouteName="CharacterStack">
      <BottomTab.Screen
        name="CharacterStack"
        component={CharacterStackNavigator}
        options={{
          title: "Characters",
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
        }}
      />
      <BottomTab.Screen
        name="Chat"
        component={Chat}
        options={({ navigation }: BottomTabScreenProps<"Chat">) => ({
          title: "Chat",
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
      <BottomTab.Screen
        name="SettingsStack"
        component={SettingsStackNavigator}
        options={{
          title: "Settings",
          headerShown: false,
          tabBarIcon: ({ color }) => <TabBarIcon name="gear" color={color} />,
        }}
      />
    </BottomTab.Navigator>
  )
}
