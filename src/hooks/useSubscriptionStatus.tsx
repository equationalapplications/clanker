import React, {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
  ReactNode,
} from 'react'
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
  try {
    const { data, error } = await supabaseClient
      .from('user_app_subscriptions')
      .select('terms_accepted_at, terms_version, plan_status')
      .eq('user_id', userId)
      .eq('app_name', APP_NAME)
      .eq('plan_status', 'active')
      .maybeSingle()

    if (error || !data || !data.terms_accepted_at) return 'none'
    if (data.terms_version === TERMS.version) return 'current'
    return 'outdated'
  } catch {
    return 'none'
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
  const [localTermsAccepted, setLocalTermsAccepted] = useState(false)

  const checkStatus = useCallback(async () => {
    setIsLoading(true)
    try {
      // If user already accepted terms optimistically, don't block them
      if (localTermsAccepted) {
        setNeedsTermsAcceptance(false)
        setIsUpdate(false)
        setIsLoading(false)
        return
      }

      const {
        data: { user },
      } = await supabaseClient.auth.getUser()

      if (user) {
        const dbResult = await checkTermsInDb(user.id)

        if (dbResult === 'current') {
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
      console.error('Error checking subscription status:', error)
      if (localTermsAccepted) {
        setNeedsTermsAcceptance(false)
      } else {
        // Fail closed: on error, require terms acceptance to be safe
        setNeedsTermsAcceptance(true)
      }
      setIsUpdate(false)
    } finally {
      setIsLoading(false)
    }
  }, [localTermsAccepted])

  // Allow optimistic update - user clicked accept, let them through immediately
  const markTermsAccepted = () => {
    setLocalTermsAccepted(true)
    setNeedsTermsAcceptance(false)
    setIsUpdate(false)
  }

  useEffect(() => {
    checkStatus()

    const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {
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
