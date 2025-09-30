/**
 * Learn more about deep linking with React Navigation
 * https://reactnavigation.org/docs/deep-linking
 * https://reactnavigation.org/docs/configuring-links
 */

import { LinkingOptions } from "@react-navigation/native"
import * as Linking from "expo-linking"

import { RootStackParamList } from "./types"

export const linkingConfig: LinkingOptions<RootStackParamList> = {
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
          SettingsStack: {
            screens: {
              Settings: "settings",
              Profile: "profile",
            },
          },
        },
      },
      Subscribe: "subscribe",
      Privacy: "privacy",
      Terms: "terms",
      NotFound: "*",
    },
  },
}
