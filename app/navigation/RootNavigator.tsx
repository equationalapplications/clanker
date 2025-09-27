import { useNavigation } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import * as Linking from "expo-linking"
import React, { useEffect, useState } from "react"

import { BottomTabNavigator } from "./BottomTabNavigator"
import { RootStackParamList, RootStackScreenProps } from "./types"
import { CreditCounterIcon } from "../components/CreditCounterIcon"
import { TabBarIcon } from "../components/TabBarIcon"
// import { purchasesConfig } from "../config/purchasesConfig"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import NotFoundScreen from "../screens/NotFoundScreen"
import Privacy from "../screens/Privacy"
import SignIn from "../screens/SignIn"
import SubscribeModal from "../screens/SubscribeModal"
import Terms from "../screens/Terms"

/**
 * A root stack navigator is often used for displaying modals on top of all other content.
 * https://reactnavigation.org/docs/modal
 */

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function RootNavigator() {
  const user = useUser()
  const userPrivate = useUserPrivate()
  const hasAcceptedTermsDate = userPrivate?.hasAcceptedTermsDate
  const url = Linking.useURL()
  const [deepLink, setDeepLink] = useState<string | null>(null)
  const navigation = useNavigation()

  // useEffect(() => {
  //   if (user) {
  //     purchasesConfig(user.uid)
  //   }
  // }, [user])

  useEffect(() => {
    if (url && !deepLink) {
      setDeepLink(url)
    }
  }, [url])

  // useEffect(() => {
  //   if (deepLink && user && hasAcceptedTermsDate) {
  //     const { path, queryParams } = Linking.parse(deepLink)
  //     if (path === "chat") {
  //       const { id, userId } = queryParams
  //       if (id && userId) {
  //         // @ts-ignore
  //         navigation.navigate("Chat", { id, userId })
  //       }
  //     }
  //   }
  // }, [deepLink, user, hasAcceptedTermsDate])

  return (
    <Stack.Navigator>
      {user && hasAcceptedTermsDate ? (
        <>
          <Stack.Group navigationKey={user && hasAcceptedTermsDate ? "user" : "guest"}>
            <Stack.Screen
              name="Home"
              component={BottomTabNavigator}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="SignIn"
              component={SignIn}
              options={{ headerShown: false, title: "Sign In" }}
            />
            <Stack.Screen
              name="Terms"
              component={Terms}
              options={{ title: "Terms and Conditions" }}
            />
            <Stack.Screen
              name="Privacy"
              component={Privacy}
              options={{ title: "Privacy Policy" }}
            />
            <Stack.Screen name="NotFound" component={NotFoundScreen} options={{ title: "Oops!" }} />
            <Stack.Group screenOptions={{ presentation: "modal" }}>
              <Stack.Screen
                name="Subscribe"
                component={SubscribeModal}
                options={{
                  title: "Subscribe",
                }}
              />
            </Stack.Group>
          </Stack.Group>
        </>
      ) : (
        <>
          <Stack.Group navigationKey={user && hasAcceptedTermsDate ? "user" : "guest"}>
            <Stack.Screen
              name="SignIn"
              component={SignIn}
              options={{ headerShown: false, title: "Sign In" }}
            />
            <Stack.Screen name="Privacy" component={Privacy} options={{ title: "Privacy" }} />
            <Stack.Screen name="Terms" component={Terms} options={{ title: "Terms" }} />
            <Stack.Screen name="NotFound" component={NotFoundScreen} options={{ title: "Oops!" }} />
          </Stack.Group>
        </>
      )}
    </Stack.Navigator>
  )
}
