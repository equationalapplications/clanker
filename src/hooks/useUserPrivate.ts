import { useEffect, useState } from 'react'
import { UserPrivate, getUserPrivate } from '../services/userService'
import { supabaseClient } from '../config/supabaseClient'

/**
 * Hook to get user private data from Supabase
 * Combines profile data with credits from user_app_subscriptions
 */
export function useUserPrivate(): UserPrivate | null {
  const [userPrivate, setUserPrivate] = useState<UserPrivate | null>(null)

  useEffect(() => {
    let mounted = true

    // Fetch initial data
    const fetchUserPrivate = async () => {
      const data = await getUserPrivate()
      if (mounted) {
        setUserPrivate(data)
      }
    }

    fetchUserPrivate()

    // Subscribe to auth changes
    const { data: authListener } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const data = await getUserPrivate()
        if (mounted) {
          setUserPrivate(data)
        }
      } else {
        if (mounted) {
          setUserPrivate(null)
        }
      }
    })

    return () => {
      mounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  return userPrivate
}