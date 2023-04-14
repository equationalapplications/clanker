import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React, { useEffect } from "react"

import { BottomTabNavigator } from "./BottomTabNavigator"
import { RootStackParamList, RootStackScreenProps } from "./types"
import { CreditCounterIcon } from "../components/CreditCounterIcon"
import { TabBarIcon } from "../components/TabBarIcon"
import { purchasesConfig } from "../config/purchasesConfig"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"
import NotFoundScreen from "../screens/NotFoundScreen"
import Privacy from "../screens/Privacy"
import Profile from "../screens/Profile"
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

  useEffect(() => {
    if (user) {
      purchasesConfig(user.uid)
    }
  }, [user])

  return (
    <Stack.Navigator>
      {user && hasAcceptedTermsDate ? (
        <>
          <Stack.Group navigationKey={user && hasAcceptedTermsDate ? "user" : "guest"}>
            <Stack.Screen
              name="Tab"
              component={BottomTabNavigator}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="SignIn"
              component={SignIn}
              options={{ headerShown: false, title: "Sign In" }}
            />
            <Stack.Screen
              name="Profile"
              component={Profile}
              options={({ navigation }: RootStackScreenProps<"Profile">) => ({
                title: "Profile",
                headerRight: () => <CreditCounterIcon navigation={navigation} />,
              })}
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
                options={({ navigation }: RootStackScreenProps<"Subscribe">) => ({
                  title: "Subscribe",
                  tabBarIcon: ({ color }) => <TabBarIcon name="edit" color={color} />,
                  headerRight: () => <CreditCounterIcon navigation={navigation} />,
                })}
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
