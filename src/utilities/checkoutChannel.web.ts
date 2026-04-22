import {
  CHECKOUT_SCHEMA_VERSION,
  hasFiniteTimestamp,
  isCheckoutStatus,
  type CheckoutAttemptRecord,
} from './checkoutStateStore'

export type CheckoutEventType =
  | 'CHECKOUT_STARTED'
  | 'CHECKOUT_SUCCEEDED'
  | 'CHECKOUT_CANCELLED'
  | 'CHECKOUT_STALE_CLEARED'

export interface CheckoutChannelEvent {
  type: CheckoutEventType
  payload: CheckoutAttemptRecord
}

export type CheckoutChannelHandler = (event: CheckoutChannelEvent) => void

export interface CheckoutChannel {
  publish: (event: CheckoutChannelEvent) => void
  subscribe: (handler: CheckoutChannelHandler) => () => void
  close: () => void
}

export interface CreateCheckoutChannelOptions {
  uid: string
}

const CHANNEL_PREFIX = 'checkout:channel:'

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function getStorage(): Storage | null {
  try {
    const storageCandidate =
      (globalThis as { localStorage?: Storage }).localStorage ??
      (hasWindow() ? window.localStorage : undefined)

    return storageCandidate ?? null
  } catch {
    return null
  }
}

function getChannelStorageKey(uid: string): string {
  return `${CHANNEL_PREFIX}${uid}`
}

function isKnownType(type: string): type is CheckoutEventType {
  return (
    type === 'CHECKOUT_STARTED' ||
    type === 'CHECKOUT_SUCCEEDED' ||
    type === 'CHECKOUT_CANCELLED' ||
    type === 'CHECKOUT_STALE_CLEARED'
  )
}

function isValidEvent(value: unknown): value is CheckoutChannelEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const event = value as Partial<CheckoutChannelEvent>

  if (!event.type || typeof event.type !== 'string' || !isKnownType(event.type)) {
    return false
  }

  const payload = event.payload as Partial<CheckoutAttemptRecord> | undefined

  return (
    !!payload &&
    typeof payload.attemptId === 'string' &&
    typeof payload.productType === 'string' &&
    isCheckoutStatus(payload.status) &&
    hasFiniteTimestamp(payload.at) &&
    typeof payload.sourceTabId === 'string' &&
    payload.schemaVersion === CHECKOUT_SCHEMA_VERSION
  )
}

export function createCheckoutChannel({ uid }: CreateCheckoutChannelOptions): CheckoutChannel {
  const listeners = new Set<CheckoutChannelHandler>()
  const channelName = `clanker:${uid}:checkout`
  let broadcastChannel: BroadcastChannel | null = null
  let removeStorageListener: (() => void) | null = null

  const dispatch = (event: CheckoutChannelEvent): void => {
    listeners.forEach((listener) => {
      try {
        listener(event)
      } catch {
        // Keep dispatch fanout resilient when a listener throws.
      }
    })
  }

  const onExternalEvent = (candidate: unknown): void => {
    if (!isValidEvent(candidate)) {
      return
    }

    dispatch(candidate)
  }

  if (typeof globalThis.BroadcastChannel === 'function') {
    try {
      broadcastChannel = new globalThis.BroadcastChannel(channelName)
      broadcastChannel.onmessage = (message: MessageEvent<unknown>) => {
        onExternalEvent(message.data)
      }
    } catch {
      broadcastChannel = null
    }
  }

  if (
    !broadcastChannel &&
    hasWindow() &&
    typeof window.addEventListener === 'function' &&
    typeof window.removeEventListener === 'function'
  ) {
    const storageListener = (event: StorageEvent): void => {
      if (event.key !== getChannelStorageKey(uid) || !event.newValue) {
        return
      }

      try {
        const envelope = JSON.parse(event.newValue) as { event?: unknown }
        onExternalEvent(envelope.event)
      } catch {
        // Ignore malformed fallback payloads.
      }
    }

    window.addEventListener('storage', storageListener)
    removeStorageListener = () => {
      window.removeEventListener('storage', storageListener)
    }
  }

  const publish = (event: CheckoutChannelEvent): void => {
    if (!isValidEvent(event)) {
      return
    }

    // Storage events do not fire in the originating tab, so dispatch locally first.
    dispatch(event)

    if (broadcastChannel) {
      try {
        broadcastChannel.postMessage(event)
      } catch {
        // Ignore broadcast failures and keep local behavior deterministic.
      }
      return
    }

    const storage = getStorage()

    if (!storage) {
      return
    }

    try {
      storage.setItem(
        getChannelStorageKey(uid),
        JSON.stringify({
          event,
          nonce: `${Date.now()}-${Math.random()}`,
        }),
      )
    } catch {
      // Ignore fallback storage failures.
    }
  }

  const subscribe = (handler: CheckoutChannelHandler): (() => void) => {
    listeners.add(handler)
    return () => {
      listeners.delete(handler)
    }
  }

  const close = (): void => {
    listeners.clear()

    if (removeStorageListener) {
      removeStorageListener()
      removeStorageListener = null
    }

    if (broadcastChannel) {
      try {
        broadcastChannel.close()
      } catch {
        // Ignore close errors.
      }
      broadcastChannel = null
    }
  }

  return {
    publish,
    subscribe,
    close,
  }
}
