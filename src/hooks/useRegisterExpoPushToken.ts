import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { getCloudAgentBaseUrl } from '../../shared/localCloudAgent'
import { getCurrentUser } from '~/config/firebaseConfig'

interface Options {
  enabled: boolean
  projectId: string
}

export function useRegisterExpoPushToken({ enabled, projectId }: Options): void {
  useEffect(() => {
    if (!enabled) return
    void (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync()
        const { status } = existing === 'granted'
          ? { status: 'granted' as const }
          : await Notifications.requestPermissionsAsync()
        if (status !== 'granted') return

        const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId })
        const user = getCurrentUser()
        if (!user) return
        const idToken = await user.getIdToken()

        const response = await fetch(`${getCloudAgentBaseUrl()}/agent/user/expo-push-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ expoPushToken }),
        })
        if (!response.ok) throw new Error(`Expo push token registration failed: ${response.status}`)
      } catch (error) {
        console.error('Failed to register Expo push token', error)
      }
    })()
  }, [enabled, projectId])
}
