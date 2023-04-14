/**
 * Learn more about using TypeScript with React Navigation:
 * https://reactnavigation.org/docs/typescript/
 */

import { BottomTabScreenProps } from "@react-navigation/bottom-tabs"
import { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native"
import { NativeStackScreenProps } from "@react-navigation/native-stack"

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

export type RootStackParamList = {
  Home: NavigatorScreenParams<RootTabParamList> | undefined
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

export type CharacterStackParamList = {
  Characters: undefined
  EditCharacter: { id: string }
}

export type CharacterStackScreenProps<Screen extends keyof CharacterStackParamList> =
  NativeStackScreenProps<CharacterStackParamList, Screen>

export type SettingsStackParamList = {
  Settings: undefined
  Profile: undefined
}

export type SettingsStackScreenProps<Screen extends keyof SettingsStackParamList> =
  NativeStackScreenProps<SettingsStackParamList, Screen>

export type RootTabParamList = {
  CharacterStack: NavigatorScreenParams<CharacterStackParamList> | undefined
  Chat: { id?: string; userId?: string }
  SettingsStack: NavigatorScreenParams<SettingsStackParamList> | undefined
}

export type RootTabScreenProps<Screen extends keyof RootTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<RootTabParamList, Screen>,
  NativeStackScreenProps<RootStackParamList>
>
