import { useCallback, useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { isProactivePushData } from '~/hooks/useProactiveSync'

// The hook routes, it does not interpret: anything without a proactive type
// AND a /chat/ deepLink is ignored, so a malformed or foreign payload cannot
// send the user anywhere unexpected.
const CHAT_DEEPLINK_PATTERN = /^\/chat\//

export function useProactiveNotificationRouting({
  triggerSync,
}: {
  triggerSync: () => void
}): void {
  const routeIfProactive = useCallback(
    (data: unknown): boolean => {
      if (!isProactivePushData(data)) return false
      const deepLink = typeof data.deepLink === 'string' ? data.deepLink : ''
      if (!CHAT_DEEPLINK_PATTERN.test(deepLink)) return false
      // Push is a hint (Phase 2 Decision 5): sync fires non-blocking and
      // navigation never waits on the network — the 5s poll plus the sync's
      // cache invalidation populate the thread as the data lands.
      triggerSync()
      router.push(deepLink as never)
      return true
    },
    [triggerSync],
  )

  // Running-app taps: the response listener fires for taps that arrive while
  // the app is mounted.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((res) => {
      routeIfProactive(res.notification.request.content.data)
    })
    return () => subscription.remove()
  }, [routeIfProactive])

  // Cold start (and any post-mount tap on iOS): useLastNotificationResponse
  // holds the response that launched the app. Clear it after routing so the
  // same response isn't re-routed on the next render.
  const lastResponse = Notifications.useLastNotificationResponse()
  useEffect(() => {
    if (!lastResponse) return
    if (routeIfProactive(lastResponse.notification.request.content.data)) {
      void Notifications.clearLastNotificationResponseAsync()
    }
  }, [lastResponse, routeIfProactive])
}
