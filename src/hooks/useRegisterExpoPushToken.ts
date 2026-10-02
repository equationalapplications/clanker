import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { isDevSandboxEnabled } from '~/auth/devSandboxFlag'
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

function createInstallationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `install_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  )
}

function getWebPushInstallationId(): string {
  try {
    let installationId = localStorage.getItem(WEB_INSTALLATION_ID_KEY)
    if (!installationId) {
      installationId = createInstallationId()
      localStorage.setItem(WEB_INSTALLATION_ID_KEY, installationId)
    }
    return installationId
  } catch {
    return createInstallationId()
  }
}

function isWebPushConfigured(): boolean {
  return Boolean(getNotificationConfig()?.vapidPublicKey)
}

async function registerWebPushToken(projectId: string, applicationId: string): Promise<void> {
  const devicePushToken = await Notifications.getDevicePushTokenAsync()
  if (devicePushToken.type !== 'web') {
    throw new Error(`Expected web device push token, got ${devicePushToken.type}`)
  }

  await registerExpoPushTokenFn({
    webDevicePushToken: devicePushToken,
    projectId,
    applicationId,
    deviceId: getWebPushInstallationId(),
    capabilities: { proactivePush: true },
  })
}

export function useRegisterExpoPushToken({ enabled, projectId }: Options): void {
  // Track the previous enabled value so the true→false transition can fire a
  // capability-only downgrade (no token, just `proactivePush: false`). The
  // server then clears the flag without overwriting expo_push_token, which
  // may belong to another device or to the same device after re-enable. A
  // single render of `enabled=false` (mount with no prior true) skips the
  // downgrade.
  const wasEnabledRef = useRef(enabled)
  useEffect(() => {
    const wasEnabled = wasEnabledRef.current
    wasEnabledRef.current = enabled

    if (!enabled) {
      // True→false transition: clear the server flag. Skip on the very first
      // render when there's nothing to downgrade, and skip in the dev sandbox
      // where every callable fails.
      if (!wasEnabled || isDevSandboxEnabled()) return
      void (async () => {
        try {
          if (!getCurrentUser()) return
          await appCheckReady
          // Capability-only shape: no token in the payload. The server sees
          // the empty token + webDevicePushToken shape and routes to a flag-
          // only update that leaves expo_push_token untouched.
          await registerExpoPushTokenFn({
            capabilities: { proactivePush: false },
          })
        } catch (error) {
          console.error('Failed to clear proactivePushReady on disable', error)
        }
      })()
      return
    }

    // The mock-auth sandbox has no real Firebase identity, so the callable
    // rejects with "Authentication required" — registering can never succeed.
    if (isDevSandboxEnabled()) return
    if (Platform.OS === 'web' && !isWebPushConfigured()) return
    void (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync()
        const { status } =
          existing === 'granted'
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
        await registerExpoPushTokenFn({
          expoPushToken,
          capabilities: { proactivePush: true },
        })
      } catch (error) {
        console.error('Failed to register Expo push token', error)
      }
    })()
  }, [enabled, projectId])
}
