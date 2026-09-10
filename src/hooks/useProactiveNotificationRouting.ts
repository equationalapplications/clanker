import { useCallback, useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { isProactivePushData } from '~/hooks/useProactiveSync'
import { proactiveUnreadKeys } from '~/hooks/useProactiveUnread'
import { resolveLocalCharacterId } from '~/database/characterDatabase'
import { markProactiveReadLocally } from '~/database/messageDatabase'
import { enqueueMarkRead } from '~/services/proactiveReadQueue'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'
import { getDatabase } from '~/database/index'

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
  triggerSync: () => Promise<void> | void
}): void {
  const queryClient = useQueryClient()

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

  const markThreadReadAfterSync = useCallback(
    async (characterId: string): Promise<void> => {
      // The chat's own useMarkProactiveReadOnOpen runs on focus, but it
      // counts unread BEFORE the tap-triggered sync inserts the new
      // messages — those arrive AFTER the focus effect ran and stay marked
      // unread on the server until the next sync or focus. Mark the thread
      // read here, atomically (local read_at + durable queue), so the
      // tap-opened thread reflects the unread count as soon as the sync
      // completes.
      try {
        const db = await getDatabase()
        let ids: string[] = []
        await db.withTransactionAsync(async () => {
          ids = await markProactiveReadLocally(characterId, db)
          if (ids.length > 0) {
            await enqueueMarkRead(ids, undefined, db)
          }
        })
        if (ids.length > 0) {
          void enqueueMarkRead(ids, markProactiveReadViaCallable)
        }
        await queryClient.invalidateQueries({ queryKey: proactiveUnreadKeys.all })
      } catch (error) {
        console.warn('[proactiveNotification] post-sync mark-read failed:', error)
      }
    },
    [queryClient],
  )

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
      // CHAT_DEEPLINK_PATTERN guarantees the segment after `/chat/` is a
      // single id-shaped token, so a fixed-offset slice is safe.
      // The server builds the deepLink from the CLOUD character UUID, but
      // `/chat/<id>` is matched against the local ids useTabCharacterId
      // validates, and markProactiveReadLocally filters on the local id too.
      // Resolve before doing either — see resolveLocalCharacterId.
      const cloudCharacterId = deepLink.slice('/chat/'.length)
      // Push is a hint (Phase 2 Decision 5): sync fires non-blocking and
      // navigation never waits on the network. But the chat-mount mark-read
      // sees an unread count of zero BEFORE the sync inserts the new
      // messages, so those would stay unread on the server until the next
      // sync. Chain the post-sync mark-read behind triggerSync to close the
      // gap. The only thing navigation now waits on is a single indexed local
      // SQLite read, not the network.
      const syncPromise = triggerSync()
      void (async () => {
        let characterId: string | undefined
        try {
          characterId = await resolveLocalCharacterId(cloudCharacterId)
        } catch (error) {
          // A failed lookup must not strand the user on a dead /chat/<id>
          // route. The /chat/<id> route is validated against the set of
          // LOCAL character ids (see useTabCharacterId), so pushing the
          // unresolved cloud id lands on a route the router has no record
          // of — worse than not navigating at all. Fall back to the chat
          // index, which has its own no-characters / loading states.
          console.warn('[proactiveNotification] local id resolve failed:', error)
          router.push('/chat' as never)
          // The post-sync mark-read targets the local id; with no local id
          // there is nothing to mark, so skip that step entirely.
          if (syncPromise && typeof syncPromise.then === 'function') {
            await syncPromise
          }
          return
        }
        router.push(`/chat/${characterId}` as never)
        if (syncPromise && typeof syncPromise.then === 'function') {
          await syncPromise
          await markThreadReadAfterSync(characterId)
        }
      })()
      return true
    },
    [triggerSync, markThreadReadAfterSync],
  )

  // Running-app taps: the response listener fires for taps that arrive while
  // the app is mounted.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((res) => {
      routeIfProactive(res.notification.request.content.data, res.notification.request.identifier)
    })
    return () => subscription.remove()
  }, [routeIfProactive])

  // Cold start: the response that launched the app predates the listener above,
  // so it has to be read once on mount. Clear it after routing so the same
  // response isn't re-routed. The dedupe set above covers the (rare) case where
  // both this read and the listener see the same tap.
  //
  // This deliberately does NOT use `Notifications.useLastNotificationResponse()`.
  // That hook reads `getLastNotificationResponse()` from a layout effect, and
  // expo-notifications ships no web implementation of that method — it throws
  // UnavailabilityError on mount, which (with no error boundary above this hook)
  // unmounts the tree and renders a blank page. Being a hook, it also cannot be
  // called behind a platform guard, so the read is inlined here where the guard
  // can live. Only this cold-start read is native-only: the response listener
  // above is emitter-based and still delivers web push taps.
  //
  // Deps are [routeIfProactive] alone — no subscription to the SDK's cached
  // response exists, so there is nothing else to re-run on. That is safe
  // because this effect and the listener effect above share the same dep:
  // React runs the listener's destroy and create in one synchronous commit,
  // so a re-subscribe never leaves a listener-less window, and this read
  // re-runs on the same identity change (logout/login), picking up any
  // response the SDK cached in the meantime.
  useEffect(() => {
    if (Platform.OS === 'web') return
    try {
      const lastResponse = Notifications.getLastNotificationResponse()
      if (!lastResponse) return
      if (
        routeIfProactive(
          lastResponse.notification.request.content.data,
          lastResponse.notification.request.identifier,
        )
      ) {
        // Swallow rejections: the SDK-side cached response staying put is
        // harmless here — the dedupe set above already prevents the same
        // identifier from routing twice — but an unhandled rejection would
        // crash dev builds and surface in error reporting.
        void Notifications.clearLastNotificationResponseAsync().catch(() => {})
      }
    } catch (error) {
      console.warn('[proactiveNotification] cold-start response read failed:', error)
    }
  }, [routeIfProactive])
}
