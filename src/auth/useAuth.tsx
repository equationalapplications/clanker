import {
  createContext,
  useContext,
  ReactNode,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react'
import { Alert } from 'react-native'
import { authManager } from '~/auth/authManager'
import { supabaseClient } from '~/config/supabaseClient'
import { queryClient } from '~/config/queryClient'
import {
  getCurrentUser,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from '~/config/firebaseConfig'
import { signOutFromGoogle } from '~/auth/googleSignin'
import { loginRevenueCat, logoutRevenueCat } from '~/config/revenueCatConfig'

// Union type for platform-specific user
type AuthUser = ReturnType<typeof getCurrentUser>

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  signOut?: () => Promise<void>
  refreshSession?: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(getCurrentUser()) // Firebase user is the SOURCE OF TRUTH
  const [isLoading, setIsLoading] = useState(true)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshSessionRef = useRef<(() => Promise<void>) | undefined>(undefined)
  // Tracks whether Firebase has EVER provided a non-null user in this session.
  // On web, onAuthStateChanged fires null before restoring the persisted user,
  // so we must not destroy the Supabase session on that initial null.
  const hasHadUser = useRef(!!getCurrentUser())

  // Avoid stale state in onAuthStateChanged
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  // Schedule automatic token refresh before expiry
  const scheduleTokenRefresh = useCallback((expiresIn: number) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }

    // Refresh 5 minutes before expiry, or immediately if less than 5 minutes left
    const refreshTime = Math.max((expiresIn - 300) * 1000, 0)
    console.log(`⏰ Scheduling token refresh in ${Math.round(refreshTime / 1000 / 60)} minutes`)

    refreshTimerRef.current = setTimeout(() => {
      void refreshSessionRef.current?.().catch((error) => {
        console.error('❌ Unhandled error during scheduled session refresh:', error)
      })
    }, refreshTime)
  }, [])

  // Function to refresh the Supabase session via exchangeToken
  const refreshSession = useCallback(async () => {
    const firebaseUser = getCurrentUser()
    if (!firebaseUser) {
      console.log('🔄 No Firebase user, skipping session refresh')
      return
    }

    try {
      console.log('🔄 Refreshing Supabase session via exchangeToken...')
      authManager.reset() // Reset to allow re-authentication
      const session = await authManager.authenticateSupabase()
      await supabaseClient.auth.setSession(session)
      console.log('✅ Session refreshed successfully')

      // Schedule next refresh (refresh 5 minutes before expiry)
      scheduleTokenRefresh(session.expires_in || 3600)
    } catch (error) {
      console.error('❌ Failed to refresh session:', error)
      // On refresh failure, the user will need to re-authenticate
    }
  }, [scheduleTokenRefresh])

  // Keep the ref in sync with the latest refreshSession callback
  useEffect(() => {
    refreshSessionRef.current = refreshSession
  }, [refreshSession])

  // SINGLE SOURCE OF TRUTH: Firebase auth state drives everything
  useEffect(() => {
    // Platform-specific auth listener
    const unsubscribeAuth = onAuthStateChanged(async (firebaseUser: AuthUser | null) => {
      console.log(
        '🔥 Firebase auth state changed (SOURCE OF TRUTH):',
        !!firebaseUser,
        firebaseUser?.email,
      )

      if (firebaseUser) {
        hasHadUser.current = true
        try {
          // check if the user is the same as before
          if (userRef.current && firebaseUser.uid === userRef.current.uid) {
            console.log('ℹ️ Firebase user unchanged, skipping re-authentication')
            void loginRevenueCat(firebaseUser.uid)
            setIsLoading(false)
          } else {
            setUser(firebaseUser)
            console.log('🔐 Firebase user authenticated, ensuring Supabase sync...')
            const session = await authManager.authenticateSupabase()
            const authResponse = await supabaseClient.auth.setSession(session)

            // Schedule token refresh before expiry
            const expiresIn = session.expires_in || 3600
            scheduleTokenRefresh(expiresIn)

            // Debug: Decode and log JWT custom claims
            if (authResponse.data.session?.access_token) {
              try {
                const token = authResponse.data.session.access_token
                const payload = JSON.parse(atob(token.split('.')[1]))
                console.log('🔍 JWT Custom Claims Debug:', {
                  userId: payload.sub,
                  email: payload.email,
                  plans: payload.plans ?? '⚠️ missing — hook not enabled',
                })
              } catch (decodeError) {
                console.error('❌ Error decoding JWT:', decodeError)
              }
            }

            console.log('✅ Supabase sync complete.', authResponse)
            void loginRevenueCat(firebaseUser.uid)
            setIsLoading(false)
          }
        } catch (error) {
          console.error('❌ Error during Supabase authentication:', error)
          setUser(null)
          setIsLoading(false)
          await supabaseClient.auth.signOut({ scope: 'local' })
          authManager.reset()
          Alert.alert('Authentication failed. Please try again.')
        }
      } else {
        setUser(null)
        setIsLoading(false)
        if (hasHadUser.current) {
          // Real sign-out: Firebase user was present, then became null
          console.log('🚪 Firebase user signed out, clearing Supabase session')
          await supabaseClient.auth.signOut({ scope: 'local' })
          authManager.reset()
          // Clear refresh timer
          if (refreshTimerRef.current) {
            clearTimeout(refreshTimerRef.current)
            refreshTimerRef.current = null
          }
        } else {
          // Initial null on web: Firebase hasn't yet restored the persisted user.
          // Do NOT destroy the Supabase session — it may be valid and will be
          // confirmed when Firebase fires the next event with the real user.
          console.log('ℹ️ Firebase initial null (likely web page load), preserving Supabase session')
        }
      }
    })

    return () => {
      unsubscribeAuth()
      // Cleanup refresh timer on unmount
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [scheduleTokenRefresh]) // Add scheduleTokenRefresh as dependency

  const signOut = async () => {
    try {
      console.log('🔓 Signing out from RevenueCat...')
      await logoutRevenueCat()

      console.log('🧹 Signing out from Supabase...')
      await supabaseClient.auth.signOut()

      console.log('🔥 Signing out from Firebase...')
      await firebaseSignOut()

      // Also revoke/sign out of Google so next login prompts account selection
      console.log('🔒 Revoking Google access & signing out...')
      await signOutFromGoogle()
      setUser(null)

      console.log('🗑️ Clearing React Query cache...')
      queryClient.clear()

      console.log('🔄 Resetting auth manager...')
      authManager.reset()

      console.log('✅ Sign-out process completed')
    } catch (error) {
      console.error('❌ Error signing out:', error)
      throw new Error('Failed to sign out. Please try again.')
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
