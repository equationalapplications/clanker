import { useEffect } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { appCheckReady, getCurrentUser, registerExpoPushTokenFn } from '~/config/firebaseConfig'

interface Options {
  enabled: boolean
  projectId: string
}

type ExpoNotificationConfig = {
  vapidPublicKey?: string
  serviceWorkerPath?: string
}

const WEB_INSTALLATION_ID_KEY = 'EXPO_NOTIFICATIONS_INSTALLATION_ID'

function getNotificationConfig(): ExpoNotificationConfig | undefined {
  return (Constants.expoConfig as { notification?: ExpoNotificationConfig } | null)?.notification
}

function getWebPushApplicationId(): string | undefined {
  // Web export embeds scheme but not android.package / ios.bundleIdentifier.
  const scheme = Constants.expoConfig?.scheme
  const schemeId = Array.isArray(scheme) ? scheme[0] : scheme
  return (
    Constants.expoConfig?.android?.package ??
    Constants.expoConfig?.ios?.bundleIdentifier ??
    schemeId ??
    undefined
  )
}

function getWebPushInstallationId(): string {
  try {
    let installationId = localStorage.getItem(WEB_INSTALLATION_ID_KEY)
    if (!installationId) {
      installationId = crypto.randomUUID()
      localStorage.setItem(WEB_INSTALLATION_ID_KEY, installationId)
    }
    return installationId
  } catch {
    return crypto.randomUUID()
  }
}

function isWebPushConfigured(): boolean {
  return Boolean(getNotificationConfig()?.vapidPublicKey)
}

async function registerWebPushToken(
  projectId: string,
  applicationId: string,
): Promise<void> {
  const devicePushToken = await Notifications.getDevicePushTokenAsync()
  if (devicePushToken.type !== 'web') {
    throw new Error(`Expected web device push token, got ${devicePushToken.type}`)
  }

  await registerExpoPushTokenFn({
    webDevicePushToken: devicePushToken,
    projectId,
    applicationId,
    deviceId: getWebPushInstallationId(),
  })
}

export function useRegisterExpoPushToken({ enabled, projectId }: Options): void {
  useEffect(() => {
    if (!enabled) return
    if (Platform.OS === 'web' && !isWebPushConfigured()) return
    void (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync()
        const { status } = existing === 'granted'
          ? { status: 'granted' as const }
          : await Notifications.requestPermissionsAsync()
        if (status !== 'granted') return

        if (!getCurrentUser()) return
        await appCheckReady

        if (Platform.OS === 'web') {
          const applicationId = getWebPushApplicationId()
          if (!applicationId) {
            console.warn('Web push skipped: no applicationId in app config')
            return
          }
          await registerWebPushToken(projectId, applicationId)
          return
        }

        const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId })
        await registerExpoPushTokenFn({ expoPushToken })
      } catch (error) {
        console.error('Failed to register Expo push token', error)
      }
    })()
  }, [enabled, projectId])
}
