/**
 * Learn more about using TypeScript with React Navigation:
 * https://reactnavigation.org/docs/typescript/
 */

import { BottomTabScreenProps as NavigationBottomTabScreenProps } from "@react-navigation/bottom-tabs"
import { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

// Root Stack

export type RootStackParamList = {
  Home: NavigatorScreenParams<BottomTabParamList> | undefined
  Subscribe: { success?: string; canceled?: string; session_id?: string }
  NotFound: undefined
  SignIn: undefined
  Terms: undefined
  Privacy: undefined
}

export type RootStackScreenProps<Screen extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Screen
>

// Bottom Tab

export type BottomTabParamList = {
  CharacterStack: NavigatorScreenParams<CharacterStackParamList> | undefined
  Chat: { id?: string; userId?: string }
  SettingsStack: NavigatorScreenParams<SettingsStackParamList> | undefined
}

export type BottomTabScreenProps<Screen extends keyof BottomTabParamList> = CompositeScreenProps<
  NavigationBottomTabScreenProps<BottomTabParamList, Screen>,
  NativeStackScreenProps<RootStackParamList>
>

// Character Stack

export type CharacterStackParamList = {
  Characters: undefined
  EditCharacter: { id: string }
}

export type CharacterStackScreenProps<Screen extends keyof CharacterStackParamList> =
  NativeStackScreenProps<CharacterStackParamList, Screen>

// Settings Stack

export type SettingsStackParamList = {
  Settings: undefined
  Profile: undefined
}

export type SettingsStackScreenProps<Screen extends keyof SettingsStackParamList> =
  NativeStackScreenProps<SettingsStackParamList, Screen>
