import { Stack } from 'expo-router'

export const unstable_settings = {
  initialRouteName: 'list',
}

export default function CharactersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
