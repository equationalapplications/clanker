/**
 * Learn more about deep linking with React Navigation
 * https://reactnavigation.org/docs/deep-linking
 * https://reactnavigation.org/docs/configuring-links
 */

import { LinkingOptions } from "@react-navigation/native"
import * as Linking from "expo-linking"

import { RootStackParamList } from "./types"

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL("/")],
  config: {
    screens: {
      SignIn: "signin",
      Root: {
        screens: {
          Chat: {
            screens: {
              TabOneScreen: "chat",
            },
          },
          Settings: {
            screens: {
              TabTwoScreen: "settings",
            },
          },
        },
      },
      Paywall: "paywall",
      Subscribe: "subscribe",
      Profile: "profile",
      Characters: "characters",
      Privacy: "privacy",
      Terms: "terms",
      NotFound: "*",
    },
  },
}

export default linking
