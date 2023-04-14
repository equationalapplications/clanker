import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import React from "react"

import { CharacterStackNavigator } from "./CharacterStackNavigator"
import { RootTabParamList, RootTabScreenProps } from "./types"
import { CreditCounterIcon } from "../components/CreditCounterIcon"
import { TabBarIcon } from "../components/TabBarIcon"
import Chat from "../screens/Chat"
import Settings from "../screens/Settings"

/**
 * A bottom tab navigator displays tab buttons on the bottom of the display to switch screens.
 * https://reactnavigation.org/docs/bottom-tab-navigator
 */
const BottomTab = createBottomTabNavigator<RootTabParamList>()

export function BottomTabNavigator() {
  return (
    <BottomTab.Navigator initialRouteName="CharacterStack">
      <BottomTab.Screen
        name="CharacterStack"
        component={CharacterStackNavigator}
        options={({ navigation }) => ({
          title: "Characters",
          tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
      <BottomTab.Screen
        name="Chat"
        component={Chat}
        options={({ navigation }: RootTabScreenProps<"Chat">) => ({
          title: "Chat",
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
      <BottomTab.Screen
        name="Settings"
        component={Settings}
        options={({ navigation }: RootTabScreenProps<"Settings">) => ({
          title: "Settings",
          tabBarIcon: ({ color }) => <TabBarIcon name="gear" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
    </BottomTab.Navigator>
  )
}
