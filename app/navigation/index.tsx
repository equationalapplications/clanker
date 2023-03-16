/**
 * If you are not familiar with React Navigation, refer to the "Fundamentals" guide:
 * https://reactnavigation.org/docs/getting-started
 *
 */
import { FontAwesome } from "@expo/vector-icons"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { NavigationContainer, useNavigation } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import * as React from "react"
import { Pressable } from "react-native"
import { Badge, Text } from "react-native-paper"

//import { auth } from "../config/firebaseConfig"
import useUser from "../hooks/useUser"
import Characters from "../screens/Characters"
import Chat from "../screens/Chat"
import NotFoundScreen from "../screens/NotFoundScreen"
import PaywallScreen from "../screens/PaywallScreen"
import Privacy from "../screens/Privacy"
import Profile from "../screens/Profile"
import Settings from "../screens/Settings"
import SignIn from "../screens/SignIn"
import SubscribeModal from "../screens/SubscribeModal"
import Terms from "../screens/Terms"
import LinkingConfiguration from "./LinkingConfiguration"
import {
  RootStackParamList,
  RootStackScreenProps,
  RootTabParamList,
  RootTabScreenProps,
} from "./types"

export default function Navigation({ theme }) {
  return (
    <NavigationContainer linking={LinkingConfiguration} theme={theme}>
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
  const user = useUser()
  console.log("nav user", user)

  return (
    <Stack.Navigator>
      {user ? (
        <>
          <Stack.Group navigationKey={user ? "user" : "guest"}>
            <Stack.Screen
              name="Root"
              component={BottomTabNavigator}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="SignIn"
              component={SignIn}
              options={{ headerShown: false, title: "Sign In" }}
            />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ title: "Paywall" }} />
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
                options={{ title: "Subscribe" }}
              />
            </Stack.Group>
          </Stack.Group>
        </>
      ) : (
        <>
          <Stack.Group navigationKey={user ? "user" : "guest"}>
            <Stack.Screen
              name="SignIn"
              component={SignIn}
              options={{ headerShown: false, title: "Sign In" }}
            />
            <Stack.Screen name="Root" component={SignIn} options={{ title: "Privacy" }} />
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
    <BottomTab.Navigator initialRouteName="Character">
      <BottomTab.Screen
        name="Character"
        component={Characters}
        options={({ navigation }: RootTabScreenProps<"Character">) => ({
          title: "Character",
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
  const user = useUser()
  const [credits, setCredits] = React.useState(user?.credits)
  React.useEffect(() => {
    setCredits(user?.credits)
  }, [user])
  return (
    <Pressable
      onPress={() => navigation.navigate("Subscribe")}
      style={({ pressed }) => ({
        flexDirection: "row",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Text>Credits </Text>
      <Badge>{credits}</Badge>
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
