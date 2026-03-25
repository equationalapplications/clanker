import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  ReactNode,
} from 'react'
import Storage from 'expo-sqlite/kv-store'
import { supabaseClient } from '~/config/supabaseClient'
import { APP_NAME } from '~/config/constants'
import { TERMS } from '~/config/termsConfig'

interface SubscriptionStatus {
  needsTermsAcceptance: boolean
  isUpdate: boolean
  isLoading: boolean
  markTermsAccepted: () => void
}

/**
 * Check terms acceptance status directly from the database.
 * Returns 'current' if accepted current version, 'outdated' if accepted older version, or 'none'.
 */
async function checkTermsInDb(
  userId: string,
): Promise<'current' | 'outdated' | 'none'> {
  const { data, error } = await supabaseClient
    .from('user_app_subscriptions')
    .select('terms_accepted_at, terms_version, plan_status')
    .eq('user_id', userId)
    .eq('app_name', APP_NAME)
    .eq('plan_status', 'active')
    .maybeSingle()

  if (error) throw error
  if (!data || !data.terms_accepted_at) return 'none'
  if (data.terms_version === TERMS.version) return 'current'
  return 'outdated'
}

// --- Storage cache helpers (keyed by userId + terms version) ---
// Survives page refreshes; prevents the redirect flash while async DB check completes.

function termsKey(userId: string): string {
  return `terms_accepted_v${TERMS.version}_${userId}`
}

function readTermsCache(userId: string): boolean {
  try {
    return Storage.getItemSync(termsKey(userId)) === '1'
  } catch {
    return false
  }
}

function writeTermsCache(userId: string): void {
  try {
    Storage.setItemSync(termsKey(userId), '1')
  } catch {
    // storage errors are non-fatal
  }
}

function clearTermsCache(userId: string): void {
  try {
    Storage.removeItemSync(termsKey(userId))
  } catch {
    // storage errors are non-fatal
  }
}

// Create context for shared state across all instances
const SubscriptionStatusContext = createContext<SubscriptionStatus | null>(null)

// Provider component
export function SubscriptionStatusProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [needsTermsAcceptance, setNeedsTermsAcceptance] = useState(false)
  const [isUpdate, setIsUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Sequence counter: discard results from stale checkStatus() calls so a
  // SIGNED_OUT result can never overwrite a later SIGNED_IN result.
  const checkSeqRef = useRef(0)
  // Track last known userId so we can clear its cache entry on sign-out.
  const lastUserIdRef = useRef<string | null>(null)

  const checkStatus = useCallback(async () => {
    const seq = ++checkSeqRef.current
    setIsLoading(true)
    try {
      const {
        data: { user },
      } = await supabaseClient.auth.getUser()

      // Discard if a newer checkStatus() call has already started
      if (seq !== checkSeqRef.current) return

      if (user) {
        lastUserIdRef.current = user.id

        // Check storage cache first — prevents redirect flash during async auth
        if (readTermsCache(user.id)) {
          setNeedsTermsAcceptance(false)
          setIsUpdate(false)
          setIsLoading(false)
          return
        }

        const dbResult = await checkTermsInDb(user.id)

        // Discard if superseded
        if (seq !== checkSeqRef.current) return

        if (dbResult === 'current') {
          writeTermsCache(user.id) // Cache the positive result for next load
          setNeedsTermsAcceptance(false)
          setIsUpdate(false)
        } else if (dbResult === 'outdated') {
          setNeedsTermsAcceptance(true)
          setIsUpdate(true)
        } else {
          setNeedsTermsAcceptance(true)
          setIsUpdate(false)
        }
      } else {
        setNeedsTermsAcceptance(false)
        setIsUpdate(false)
      }
    } catch (error) {
      if (seq !== checkSeqRef.current) return
      console.error('Error checking subscription status:', error)
      // Fail open: terms acceptance is not a security boundary, so don't block
      // users on transient failures or offline scenarios.
      setNeedsTermsAcceptance(false)
      setIsUpdate(false)
    } finally {
      if (seq === checkSeqRef.current) setIsLoading(false)
    }
  }, [])

  // Allow optimistic update - user clicked accept, let them through immediately.
  // Also persist to storage so the next page refresh skips the DB check.
  const markTermsAccepted = useCallback(() => {
    if (lastUserIdRef.current) {
      writeTermsCache(lastUserIdRef.current)
    }
    setNeedsTermsAcceptance(false)
    setIsUpdate(false)
  }, [])

  useEffect(() => {
    checkStatus()

    const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && lastUserIdRef.current) {
        // Clear the cache for the signed-out user so they're prompted again on next sign-in
        clearTermsCache(lastUserIdRef.current)
        lastUserIdRef.current = null
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
        checkStatus()
      }
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [checkStatus])

  return (
    <SubscriptionStatusContext.Provider
      value={{ needsTermsAcceptance, isUpdate, isLoading, markTermsAccepted }}
    >
      {children}
    </SubscriptionStatusContext.Provider>
  )
}

// Hook to use the subscription status
export function useSubscriptionStatus(): SubscriptionStatus {
  const context = useContext(SubscriptionStatusContext)
  if (!context) {
    throw new Error('useSubscriptionStatus must be used within SubscriptionStatusProvider')
  }
  return context
}
