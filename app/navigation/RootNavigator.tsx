import { FontAwesome } from "@expo/vector-icons"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React, { useEffect } from "react"
import { Pressable } from "react-native"
import { Badge, Text } from "react-native-paper"

import {
  RootStackParamList,
  RootStackScreenProps,
  RootTabParamList,
  RootTabScreenProps,
} from "./types"
import { purchasesConfig } from "../config/purchasesConfig"
import { useIsPremium } from "../hooks/useIsPremium"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"
import Characters from "../screens/Characters"
import Chat from "../screens/Chat"
import { EditCharacter } from "../screens/EditCharacter"
import NotFoundScreen from "../screens/NotFoundScreen"
import Privacy from "../screens/Privacy"
import Profile from "../screens/Profile"
import Settings from "../screens/Settings"
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
              name="EditCharacter"
              component={EditCharacter}
              options={({ navigation }: RootStackScreenProps<"EditCharacter">) => ({
                title: "Edit Character",
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

/**
 * A bottom tab navigator displays tab buttons on the bottom of the display to switch screens.
 * https://reactnavigation.org/docs/bottom-tab-navigator
 */
const BottomTab = createBottomTabNavigator<RootTabParamList>()

function BottomTabNavigator() {
  return (
    <BottomTab.Navigator initialRouteName="Characters">
      <BottomTab.Screen
        name="Characters"
        component={Characters}
        options={({ navigation }: RootTabScreenProps<"Characters">) => ({
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

function CreditCounterIcon({ navigation }) {
  const userPrivate = useUserPrivate()
  const [credits, setCredits] = React.useState(userPrivate?.credits)
  const isPremium = useIsPremium()

  React.useEffect(() => {
    setCredits(userPrivate?.credits)
  }, [userPrivate])
  return (
    <Pressable
      onPress={() => navigation.navigate("Subscribe")}
      style={({ pressed }) => ({
        flexDirection: "row",
        opacity: pressed ? 0.5 : 1,
        marginRight: 10,
      })}
    >
      {isPremium ? (
        <>
          <Text>👑</Text>
        </>
      ) : (
        <>
          <Text>Credits </Text>
          <Badge>{credits}</Badge>
        </>
      )}
    </Pressable>
  )
}

/**
 * You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
 */
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"]
  color: string
}) {
  return <FontAwesome size={30} {...props} />
}
