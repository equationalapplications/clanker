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
          Character: {
            screens: {
              Characters: "character",
            },
          },
          Chat: {
            screens: {
              Chat: "chat",
            },
          },
          Settings: {
            screens: {
              Settings: "settings",
            },
          },
        },
      },
      Paywall: "paywall",
      Subscribe: "subscribe",
      Profile: "profile",
      Privacy: "privacy",
      Terms: "terms",
      NotFound: "*",
    },
  },
}

export default linking
