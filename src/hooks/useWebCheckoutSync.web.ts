import { useEffect, useRef, useState } from 'react'
import { getCurrentUser, onAuthStateChanged } from '~/config/firebaseConfig'
import { createCheckoutChannel, type CheckoutChannelEvent } from '~/utilities/checkoutChannel'
import {
  clearPendingCheckoutAttempts,
  expireStalePendingAttempts,
  readCheckoutAttempts,
  type CheckoutStoreMap,
} from '~/utilities/checkoutStateStore'

export interface WebCheckoutLocks {
  isPaygLocked: boolean
  isSubscribeLocked: boolean
}

export interface WebCheckoutSyncResult {
  locks: WebCheckoutLocks
  expiredMessage: string | null
  clearExpiredMessage: () => void
}

export interface UseWebCheckoutSyncOptions {
  onCheckoutSucceeded?: () => void
}

const EXPIRED_MESSAGE = 'Previous checkout timed out'

function isPaygProduct(productType: string): boolean {
  return productType === 'payg'
}

function deriveLocks(attempts: CheckoutStoreMap): WebCheckoutLocks {
  let isPaygLocked = false
  let isSubscribeLocked = false

  for (const attempt of Object.values(attempts)) {
    if (attempt.status !== 'pending') {
      continue
    }

    if (attempt.productType === 'payg') {
      isPaygLocked = true
      continue
    }

    isSubscribeLocked = true
  }

  return {
    isPaygLocked,
    isSubscribeLocked,
  }
}

export function useWebCheckoutSync(
  options: UseWebCheckoutSyncOptions = {},
): WebCheckoutSyncResult {
  const { onCheckoutSucceeded } = options
  const onCheckoutSucceededRef = useRef(onCheckoutSucceeded)
  const channelRef = useRef<ReturnType<typeof createCheckoutChannel> | null>(null)
  const uidRef = useRef<string | null>(null)
  const locksRef = useRef<WebCheckoutLocks>({
    isPaygLocked: false,
    isSubscribeLocked: false,
  })
  const [uid, setUid] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }

    return getCurrentUser()?.uid ?? null
  })

  const [locks, setLocks] = useState<WebCheckoutLocks>({
    isPaygLocked: false,
    isSubscribeLocked: false,
  })
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null)

  useEffect(() => {
    onCheckoutSucceededRef.current = onCheckoutSucceeded
  }, [onCheckoutSucceeded])

  useEffect(() => {
    uidRef.current = uid
  }, [uid])

  const clearExpiredMessage = (): void => {
    setExpiredMessage(null)
  }

  const applyLocks = (nextLocks: WebCheckoutLocks, event?: CheckoutChannelEvent): void => {
    const previousLocks = locksRef.current
    locksRef.current = nextLocks
    setLocks(nextLocks)

    if (!event) {
      return
    }

    // Log CHECKOUT_STALE_CLEARED immediately, even if status is pending
    if (event.type === 'CHECKOUT_STALE_CLEARED') {
      const wasLocked = isPaygProduct(event.payload.productType)
        ? previousLocks.isPaygLocked
        : previousLocks.isSubscribeLocked
      const isLocked = isPaygProduct(event.payload.productType)
        ? nextLocks.isPaygLocked
        : nextLocks.isSubscribeLocked

      if (wasLocked && !isLocked) {
        console.log('[checkout-sync][plan]', {
          phase: 'cross-tab-unlock',
          eventType: event.type,
          attemptId: event.payload.attemptId,
          productType: event.payload.productType,
          status: event.payload.status,
        })
      }
      return
    }

    if (event.payload.status === 'pending') {
      return
    }

    const wasLocked = isPaygProduct(event.payload.productType)
      ? previousLocks.isPaygLocked
      : previousLocks.isSubscribeLocked
    const isLocked = isPaygProduct(event.payload.productType)
      ? nextLocks.isPaygLocked
      : nextLocks.isSubscribeLocked

    if (wasLocked && !isLocked) {
      console.log('[checkout-sync][plan]', {
        phase: 'cross-tab-unlock',
        eventType: event.type,
        attemptId: event.payload.attemptId,
        productType: event.payload.productType,
        status: event.payload.status,
      })
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    return onAuthStateChanged((user) => {
      const previousUid = uidRef.current
      const nextUid = user?.uid ?? null

      if (previousUid && previousUid !== nextUid) {
        const clearedAttempts = clearPendingCheckoutAttempts(previousUid)
        clearedAttempts.forEach((attempt) => {
          channelRef.current?.publish({
            type: 'CHECKOUT_STALE_CLEARED',
            payload: attempt,
          })
        })
      }

      setUid((currentUid) => (currentUid === nextUid ? currentUid : nextUid))
    })
  }, [])

  useEffect(() => {
    if (!uid) {
      const nextLocks = { isPaygLocked: false, isSubscribeLocked: false }
      locksRef.current = nextLocks
      setLocks(nextLocks)
      return
    }

    const hydrateFromStore = (event?: CheckoutChannelEvent): void => {
      applyLocks(deriveLocks(readCheckoutAttempts(uid)), event)
    }

    hydrateFromStore()

    const channel = createCheckoutChannel({ uid })
    channelRef.current = channel

    const recoverFromSharedState = (): void => {
      const expiredAttempts = expireStalePendingAttempts(uid, Date.now(), 'tab-recovery')

      if (expiredAttempts.length === 0) {
        hydrateFromStore()
        return
      }

      setExpiredMessage(EXPIRED_MESSAGE)
      expiredAttempts.forEach((attempt) => {
        console.log('[checkout-sync][plan]', {
          phase: 'expired-transition',
          attemptId: attempt.attemptId,
          productType: attempt.productType,
          status: attempt.status,
        })
        channel.publish({
          type: 'CHECKOUT_STALE_CLEARED',
          payload: attempt,
        })
      })

      hydrateFromStore()
    }

    const unsubscribe = channel.subscribe((event) => {
      hydrateFromStore(event)

      if (event.payload.status === 'expired') {
        setExpiredMessage(EXPIRED_MESSAGE)
      }

      if (event.type === 'CHECKOUT_SUCCEEDED') {
        onCheckoutSucceededRef.current?.()
      }
    })

    const handleFocus = (): void => {
      recoverFromSharedState()
    }

    const handleVisibilityChange = (): void => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        return
      }

      recoverFromSharedState()
    }

    const canListenToWindow = typeof window.addEventListener === 'function'
    const canRemoveWindowListener = typeof window.removeEventListener === 'function'

    if (canListenToWindow) {
      window.addEventListener('focus', handleFocus)
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      if (canRemoveWindowListener) {
        window.removeEventListener('focus', handleFocus)
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      unsubscribe()
      channel.close()
      if (channelRef.current === channel) {
        channelRef.current = null
      }
    }
  }, [uid])

  return {
    locks,
    expiredMessage,
    clearExpiredMessage,
  }
}
