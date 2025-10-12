import { createContext, useContext, ReactNode, useEffect, useState, useRef } from 'react'
import { User } from 'firebase/auth'
import { auth } from '~/config/firebaseConfig'
import { authManager } from '~/auth/authManager'
import { supabaseClient } from '~/config/supabaseClient'
import { queryClient } from '~/config/queryClient'
import { Alert } from 'react-native'

interface AuthContextType {
  user: User | null
  isLoading?: boolean
  signOut?: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null) // Firebase user is the SOURCE OF TRUTH

  // Avoid stale state in onAuthStateChanged
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  }, [user])

  // SINGLE SOURCE OF TRUTH: Firebase auth state drives everything
  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
      console.log(
        '🔥 Firebase auth state changed (SOURCE OF TRUTH):',
        !!firebaseUser,
        firebaseUser?.email,
      )

      if (firebaseUser) {
        try {
          // check if the user is the same as before
          if (userRef.current && firebaseUser.uid === userRef.current.uid) {
            console.log('ℹ️ Firebase user unchanged, skipping re-authentication')
          } else {
            setUser(firebaseUser)
            console.log('🔐 Firebase user authenticated, ensuring Supabase sync...')
            const session = await authManager.authenticateSupabase()
            const authResponse = await supabaseClient.auth.setSession(session)

            // Debug: Decode and log JWT custom claims
            if (authResponse.data.session?.access_token) {
              try {
                const token = authResponse.data.session.access_token
                const payload = JSON.parse(atob(token.split('.')[1]))
                console.log('🔍 JWT Custom Claims Debug:', {
                  userId: payload.sub,
                  email: payload.email,
                  plans: payload.plans,
                  hasPlans: !!payload.plans,
                  plansCount: payload.plans?.length || 0,
                  fullPayload: payload,
                })
              } catch (decodeError) {
                console.error('❌ Error decoding JWT:', decodeError)
              }
            }

            console.log('✅ Supabase sync complete.', authResponse)
          }
        } catch (error) {
          console.error('❌ Error during Supabase authentication:', error)
          setUser(null)
          await supabaseClient.auth.signOut()
          authManager.reset()
          Alert.alert('Authentication failed. Please try again.')
        }
      } else {
        // No Firebase user - clear everything
        console.log('🚪 No Firebase user, signing out of Supabase')
        setUser(null)
        await supabaseClient.auth.signOut()
        authManager.reset()
      }
    })

    return () => {
      unsubscribeAuth()
    }
  }, []) // Run only once

  const signOut = async () => {
    try {
      console.log('🧹 Signing out from Supabase...')
      await supabaseClient.auth.signOut()

      console.log('🔥 Signing out from Firebase...')
      await auth.signOut()
      setUser(null)

      console.log('�️ Clearing React Query cache...')
      queryClient.clear()

      console.log('�🔄 Resetting auth manager...')
      authManager.reset()

      console.log('✅ Sign-out process completed')
    } catch (error) {
      console.error('❌ Error signing out:', error)
      throw new Error('Failed to sign out. Please try again.')
    }
  }

  return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
