/**
 * If you are not familiar with React Navigation, refer to the "Fundamentals" guide:
 * https://reactnavigation.org/docs/getting-started
 *
 */
import { FontAwesome } from "@expo/vector-icons"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { useAuthUser } from "@react-query-firebase/auth"
import * as React from "react"
import { ColorSchemeName, Pressable } from "react-native"

import LinkingConfiguration from "./LinkingConfiguration"
import { RootStackParamList, RootTabParamList, RootTabScreenProps } from "./types"
import { auth } from "../config/firebaseConfig"
import Colors from "../constants/Colors"
import useColorScheme from "../hooks/useColorScheme"
import Characters from "../screens/Characters"
import TabOneScreen from "../screens/Chat"
import NotFoundScreen from "../screens/NotFoundScreen"
import PaywallScreen from "../screens/PaywallScreen"
import Privacy from "../screens/Privacy"
import Profile from "../screens/Profile"
import Settings from "../screens/Settings"
import SignIn from "../screens/SignIn"
import SubscribeModal from "../screens/SubscribeModal"
import Terms from "../screens/Terms"

export default function Navigation({ colorScheme }: { colorScheme: ColorSchemeName }) {
  return (
    <NavigationContainer
      linking={LinkingConfiguration}
      theme={colorScheme === "dark" ? DarkTheme : DefaultTheme}
    >
      <RootNavigator />
    </NavigationContainer>
  )
}

/**
 * A root stack navigator is often used for displaying modals on top of all other content.
 * https://reactnavigation.org/docs/modal
 */
const Stack = createNativeStackNavigator<RootStackParamList>()

function RootNavigator() {
  const user = useAuthUser(["user"], auth)

  return (
    <Stack.Navigator>
      {user.data ? (
        <>
          <Stack.Screen
            name="Root"
            component={BottomTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Paywall" component={PaywallScreen} options={{ title: "Paywall" }} />
          <Stack.Screen name="Profile" component={Profile} options={{ title: "Profile" }} />
          <Stack.Screen
            name="Characters"
            component={Characters}
            options={{ title: "Characters" }}
          />
          <Stack.Screen name="Terms" component={Terms} options={{ title: "Terms" }} />
          <Stack.Screen name="Privacy" component={Privacy} options={{ title: "Privacy" }} />
          <Stack.Screen name="NotFound" component={NotFoundScreen} options={{ title: "Oops!" }} />
          <Stack.Group screenOptions={{ presentation: "modal" }}>
            <Stack.Screen
              name="Subscribe"
              component={SubscribeModal}
              options={{ title: "Subscribe" }}
            />
          </Stack.Group>
        </>
      ) : (
        <>
          <Stack.Screen
            name="SignIn"
            component={SignIn}
            options={{ headerShown: false, title: "Sign In" }}
          />
          <Stack.Screen name="Privacy" component={Privacy} options={{ title: "Privacy" }} />
          <Stack.Screen name="Terms" component={Terms} options={{ title: "Terms" }} />
          <Stack.Screen name="NotFound" component={NotFoundScreen} options={{ title: "Oops!" }} />
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
  const colorScheme = useColorScheme()

  return (
    <BottomTab.Navigator
      initialRouteName="Chat"
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
      }}
    >
      <BottomTab.Screen
        name="Chat"
        component={TabOneScreen}
        options={({ navigation }: RootTabScreenProps<"Chat">) => ({
          title: "Chat",
          tabBarIcon: ({ color }) => <TabBarIcon name="comments" color={color} />,
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate("Subscribe")}
              style={({ pressed }) => ({
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <FontAwesome
                name="info-circle"
                size={25}
                color={Colors[colorScheme].text}
                style={{ marginRight: 15 }}
              />
            </Pressable>
          ),
        })}
      />
      <BottomTab.Screen
        name="Settings"
        component={Settings}
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <TabBarIcon name="gear" color={color} />,
        }}
      />
    </BottomTab.Navigator>
  )
}

/**
 * You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
 */
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"]
  color: string
}) {
  return <FontAwesome size={30} style={{ marginBottom: -3 }} {...props} />
}
