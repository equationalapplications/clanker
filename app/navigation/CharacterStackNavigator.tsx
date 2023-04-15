import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"

import { CharacterStackParamList } from "./types"
import { CreditCounterIcon } from "../components/CreditCounterIcon"
import { TabBarIcon } from "../components/TabBarIcon"
import Characters from "../screens/Characters"
import { EditCharacter } from "../screens/EditCharacter"

const CharacterStack = createNativeStackNavigator<CharacterStackParamList>()

export function CharacterStackNavigator() {
  return (
    <CharacterStack.Navigator>
      <CharacterStack.Screen
        name="Characters"
        component={Characters}
        options={({ navigation }) => ({
          title: "Characters",
          tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
      <CharacterStack.Screen
        name="EditCharacter"
        component={EditCharacter}
        options={({ navigation }) => ({
          title: "Edit Character",
          tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
          headerRight: () => <CreditCounterIcon navigation={navigation} />,
        })}
      />
    </CharacterStack.Navigator>
  )
}
