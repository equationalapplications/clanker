import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React from "react"

import { RootStackParamList } from "./types"
import { useAuthentication } from "../hooks/useAuthentication"
import Dashboard from "../screens/Dashboard"
import SignIn from "../screens/SignIn"

/**
 * A root stack navigator is often used for displaying modals on top of all other content.
 * https://reactnavigation.org/docs/modal
 */

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function RootNavigator() {
  const { firebaseUser, supabaseUser } = useAuthentication()

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName={firebaseUser && supabaseUser ? "Dashboard" : "SignIn"}
    >
      <Stack.Screen
        name="SignIn"
        component={SignIn}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Dashboard"
        component={Dashboard}
        options={{ title: "Dashboard" }}
      />
    </Stack.Navigator>
  )
}
