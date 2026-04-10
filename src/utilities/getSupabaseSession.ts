import type { Session } from '@supabase/supabase-js'
import { supabaseClient } from '~/config/supabaseClient'

let inFlightSessionRead: Promise<Session | null> | null = null

/**
 * Read Supabase session with in-flight deduplication.
 * This avoids parallel storage reads on native where expo-sqlite/kv-store
 * can be sensitive to concurrent access from multiple queues.
 */
export async function getSupabaseSession(): Promise<Session | null> {
  if (inFlightSessionRead) {
    return inFlightSessionRead
  }

  inFlightSessionRead = (async () => {
    const {
      data: { session },
      error,
    } = await supabaseClient.auth.getSession()

    if (error) {
      console.error('Failed to read Supabase session:', error)
      return null
    }

    return session
  })()

  try {
    return await inFlightSessionRead
  } finally {
    inFlightSessionRead = null
  }
}
