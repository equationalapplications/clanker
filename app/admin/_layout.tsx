import { Redirect, Stack } from 'expo-router'
import { Platform } from 'react-native'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'

export default function AdminLayout() {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)

  if (Platform.OS !== 'web') {
    return <Redirect href="/" />
  }

  if (!user) {
    return <Redirect href="/sign-in" />
  }

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard' }} />
    </Stack>
  )
}
