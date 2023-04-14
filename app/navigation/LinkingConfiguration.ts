/**
 * Learn more about deep linking with React Navigation
 * https://reactnavigation.org/docs/deep-linking
 * https://reactnavigation.org/docs/configuring-links
 */

import { LinkingOptions } from "@react-navigation/native"
import * as Linking from "expo-linking"

import { RootStackParamList } from "./types"

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [Linking.createURL("/"), "https://yours-brightly-ai.equationalapplications.com"],
  config: {
    screens: {
      SignIn: "signin",
      Home: {
        screens: {
          CharacterStack: {
            screens: {
              Characters: "characters",
              EditCharacter: "edit",
            },
          },
          Chat: {
            path: "chat",
            screens: {
              Chat: "chat",
            },
          },
          Settings: {
            path: "settings",
            screens: {
              Settings: "settings",
            },
          },
        },
      },
      Subscribe: "subscribe",
      Profile: "profile",
      Privacy: "privacy",
      Terms: "terms",
      NotFound: "*",
    },
  },
}

export default linking
