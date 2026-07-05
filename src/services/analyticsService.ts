import {
  getAnalytics,
  logEvent as logEventMod,
  logScreenView as logScreenViewMod,
  setAnalyticsCollectionEnabled,
  setUserId as setUserIdMod,
} from '@react-native-firebase/analytics'
import { Storage } from '~/utilities/kvStorage'

const ANALYTICS_KEY = 'setting:analytics'

/**
 * Read the persisted analytics preference and apply it to Firebase Analytics.
 * Called once at app startup on native (web uses cookie consent instead).
 */
export async function initializeAnalytics(): Promise<void> {
  try {
    const raw = Storage.getItemSync(ANALYTICS_KEY)
    const enabled = raw === '1'
    await setAnalyticsCollectionEnabled(getAnalytics(), enabled)
    console.log(`✅ Analytics initialized (enabled: ${enabled})`)
  } catch (error) {
    console.error('❌ Error initializing Analytics:', error)
    throw error
  }
}

export function logScreenView(screenName: string): void {
  try {
    logScreenViewMod(getAnalytics(), { screen_name: screenName, screen_class: screenName })
  } catch (error) {
    console.error('❌ Error logging analytics screen view:', error)
  }
}

export function logEvent(name: string, params?: Record<string, unknown>): void {
  try {
    logEventMod(getAnalytics(), name as never, params)
  } catch (error) {
    console.error('❌ Error logging analytics event:', error)
  }
}

export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  try {
    await setAnalyticsCollectionEnabled(getAnalytics(), enabled)
  } catch (error) {
    console.error('❌ Error toggling analytics collection:', error)
  }
}

export async function setUserId(userId: string | null): Promise<void> {
  try {
    await setUserIdMod(getAnalytics(), userId ?? '')
  } catch (error) {
    console.error('❌ Error setting analytics user ID:', error)
  }
}
