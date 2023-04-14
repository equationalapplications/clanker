import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"

import { CharacterStackParamList } from "./types"
import Characters from "../screens/Characters"
import { EditCharacter } from "../screens/EditCharacter"

const CharacterStack = createNativeStackNavigator<CharacterStackParamList>()

export function CharacterStackNavigator() {
  return (
    <CharacterStack.Navigator>
      <CharacterStack.Screen
        name="Characters"
        component={Characters}
        options={{ headerShown: false, title: "Characters" }}
      />
      <CharacterStack.Screen
        name="EditCharacter"
        component={EditCharacter}
        options={{ headerShown: false, title: "Edit Character" }}
      />
    </CharacterStack.Navigator>
  )
}
