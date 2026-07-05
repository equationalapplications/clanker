import {
  getAnalytics,
  isSupported,
  logEvent as logEventMod,
  setAnalyticsCollectionEnabled,
  setUserId as setUserIdMod,
  type Analytics,
} from 'firebase/analytics'
import { firebaseApp } from '~/config/firebaseConfig.web'

type PendingCall =
  | { type: 'screen'; screenName: string }
  | { type: 'event'; name: string; params?: Record<string, unknown> }
  | { type: 'userId'; userId: string | null }

let analyticsInstance: Analytics | null = null
let analyticsInitPromise: Promise<Analytics | null> | null = null
let analyticsEnabled = false
let analyticsUnavailable = false
let pendingCalls: PendingCall[] = []

function executeCall(instance: Analytics, call: PendingCall): void {
  if (call.type === 'screen') {
    logEventMod(instance, 'screen_view', {
      firebase_screen: call.screenName,
      firebase_screen_class: call.screenName,
    })
  } else if (call.type === 'event') {
    logEventMod(instance, call.name as never, call.params)
  } else {
    setUserIdMod(instance, call.userId)
  }
}

function flushPending(instance: Analytics): void {
  for (const call of pendingCalls) {
    try {
      executeCall(instance, call)
    } catch (error) {
      console.error('❌ Error flushing queued analytics call:', error)
    }
  }
  pendingCalls = []
}

function markAnalyticsUnavailable(): void {
  analyticsUnavailable = true
  pendingCalls = []
}

function ensureAnalytics(): Promise<Analytics | null> {
  if (analyticsUnavailable) {
    return Promise.resolve(null)
  }
  if (analyticsInstance) {
    return Promise.resolve(analyticsInstance)
  }
  if (!analyticsInitPromise) {
    analyticsInitPromise = isSupported()
      .then((supported) => {
        if (!supported) {
          markAnalyticsUnavailable()
          return null
        }
        analyticsInstance = getAnalytics(firebaseApp)
        if (!analyticsEnabled) {
          // Consent may have been revoked while initialization was in-flight.
          setAnalyticsCollectionEnabled(analyticsInstance, false)
          pendingCalls = []
          return analyticsInstance
        }
        flushPending(analyticsInstance)
        return analyticsInstance
      })
      .catch((error) => {
        console.error('❌ Error initializing web analytics:', error)
        markAnalyticsUnavailable()
        return null
      })
  }
  return analyticsInitPromise
}

function enqueueOrRun(call: PendingCall): void {
  if (analyticsUnavailable || !analyticsEnabled) return
  if (analyticsInstance) {
    try {
      executeCall(analyticsInstance, call)
    } catch (error) {
      console.error('❌ Error in analytics call:', error)
    }
    return
  }
  pendingCalls.push(call)
  void ensureAnalytics()
}

export function logScreenView(screenName: string): void {
  enqueueOrRun({ type: 'screen', screenName })
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  enqueueOrRun({ type: 'event', name, params })
}

export async function initializeAnalytics(): Promise<void> {}

export function waitForAnalyticsInit(): Promise<void> {
  return Promise.resolve()
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      analyticsEnabled = true
      if (analyticsUnavailable) {
        analyticsUnavailable = false
        analyticsInitPromise = null
      }
      const instance = await ensureAnalytics()
      if (!instance) {
        analyticsEnabled = false
        return
      }
      setAnalyticsCollectionEnabled(instance, true)
      return
    }
    analyticsEnabled = false
    if (analyticsInstance) {
      setAnalyticsCollectionEnabled(analyticsInstance, false)
    }
    pendingCalls = []
  } catch (error) {
    console.error('❌ Error toggling analytics collection:', error)
  }
}

export async function setUserId(userId: string | null): Promise<void> {
  try {
    if (analyticsUnavailable || !analyticsEnabled) return
    if (analyticsInstance) {
      setUserIdMod(analyticsInstance, userId)
      return
    }
    pendingCalls.push({ type: 'userId', userId })
    const instance = await ensureAnalytics()
    if (instance) flushPending(instance)
  } catch (error) {
    console.error('❌ Error setting analytics user ID:', error)
  }
}

/** @internal Resets module state between unit tests. */
export function __resetAnalyticsForTests(): void {
  analyticsInstance = null
  analyticsInitPromise = null
  analyticsEnabled = false
  analyticsUnavailable = false
  pendingCalls = []
}
