/**
 * Learn more about using TypeScript with React Navigation:
 * https://reactnavigation.org/docs/typescript/
 */

import { NativeStackScreenProps } from "@react-navigation/native-stack"

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList { }
  }
}

// Root Stack

export type RootStackParamList = {
  Dashboard: undefined
  SignIn: undefined
}

export type RootStackScreenProps<Screen extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Screen
>
