import { useCallback, useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { isProactivePushData } from '~/hooks/useProactiveSync'

// The hook routes, it does not interpret: anything without a proactive type
// AND a /chat/<id> deepLink is ignored, so a malformed or foreign payload
// cannot send the user anywhere unexpected. The pattern requires exactly
// one valid character-id segment after /chat/ — Expo Router normalizes dot
// segments, so a loose prefix (`/^\/chat\//`) would let `/chat/../admin`
// resolve to `/admin` on authenticated web sessions.
const CHAT_DEEPLINK_PATTERN = /^\/chat\/[A-Za-z0-9_-]+$/

// Cap on the tap-dedupe set (see handledIdentifiersRef below).
const HANDLED_IDENTIFIER_LIMIT = 50

export function useProactiveNotificationRouting({
  triggerSync,
}: {
  triggerSync: () => void
}): void {
  // The response listener and `useLastNotificationResponse` can both fire
  // for the same response. Deduping by request identifier keeps `router.push`
  // from adding duplicate `/chat/<id>` entries when one tap reaches both
  // paths (CodeRabbit review finding).
  //
  // The hook is mounted for the lifetime of the app, so the set is bounded by
  // FIFO eviction rather than growing with every tap of the session. Only the
  // two paths for the SAME tap need to see each other, so a small window is
  // ample; insertion order is Set iteration order, so the oldest entry is
  // always the first one.
  const handledIdentifiersRef = useRef<Set<string>>(new Set())

  const routeIfProactive = useCallback(
    (data: unknown, identifier: string): boolean => {
      if (!isProactivePushData(data)) return false
      const deepLink = typeof data.deepLink === 'string' ? data.deepLink : ''
      if (!CHAT_DEEPLINK_PATTERN.test(deepLink)) return false
      if (handledIdentifiersRef.current.has(identifier)) return false
      handledIdentifiersRef.current.add(identifier)
      while (handledIdentifiersRef.current.size > HANDLED_IDENTIFIER_LIMIT) {
        const oldest = handledIdentifiersRef.current.values().next().value
        if (oldest === undefined) break
        handledIdentifiersRef.current.delete(oldest)
      }
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
      routeIfProactive(res.notification.request.content.data, res.notification.request.identifier)
    })
    return () => subscription.remove()
  }, [routeIfProactive])

  // Cold start (and any post-mount tap on iOS): useLastNotificationResponse
  // holds the response that launched the app. Clear it after routing so the
  // same response isn't re-routed on the next render. The dedupe set above
  // covers the (rare) case where both this hook and the listener fire for
  // the same tap.
  const lastResponse = Notifications.useLastNotificationResponse()
  useEffect(() => {
    if (!lastResponse) return
    if (
      routeIfProactive(
        lastResponse.notification.request.content.data,
        lastResponse.notification.request.identifier,
      )
    ) {
      void Notifications.clearLastNotificationResponseAsync()
    }
  }, [lastResponse, routeIfProactive])
}
