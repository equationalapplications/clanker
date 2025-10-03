import { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import { User } from 'firebase/auth'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { auth } from '../config/firebaseConfig'
import { authManager } from '../utilities/authManager'
import { supabaseClient } from '../config/supabaseClient'

interface AuthContextType {
    user: User | null
    supabaseUser: SupabaseUser | null
    isLoading?: boolean
    error?: string | null
    signOut?: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
    children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<User | null>(null) // Firebase user is the SOURCE OF TRUTH
    const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const signOut = async () => {
        try {
            // Sign out from Firebase first (source of truth)
            await auth.signOut()
            // Sign out from Supabase
            await supabaseClient.auth.signOut()
            // Reset auth manager
            authManager.reset()
        } catch (error) {
            console.error('Error signing out:', error)
            throw error
        }
    }

    // Validate that Supabase user email matches Firebase user email
    const validateEmailMatch = (firebaseUser: User, supabaseUser: SupabaseUser): boolean => {
        const firebaseEmail = firebaseUser.email?.toLowerCase()
        const supabaseEmail = supabaseUser.email?.toLowerCase()

        if (!firebaseEmail || !supabaseEmail) {
            console.warn('⚠️ Missing email in Firebase or Supabase user')
            return false
        }

        const emailsMatch = firebaseEmail === supabaseEmail
        console.log(`📧 Email validation: Firebase(${firebaseEmail}) === Supabase(${supabaseEmail}) = ${emailsMatch}`)
        return emailsMatch
    }

    // Ensure Supabase is authenticated with correct user
    const ensureSupabaseAuth = async (firebaseUser: User) => {
        console.log('🔐 Ensuring Supabase auth for Firebase user:', firebaseUser.email)

        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession()

            if (error) {
                console.log('❌ Supabase session error, re-authenticating:', error.message)
                return await authManager.authenticateSupabase()
            }

            if (!session?.user) {
                console.log('🔄 No Supabase session, authenticating...')
                return await authManager.authenticateSupabase()
            }

            // Check if emails match
            if (!validateEmailMatch(firebaseUser, session.user)) {
                console.log('🚨 Email mismatch detected, signing out and re-authenticating Supabase')
                await supabaseClient.auth.signOut()
                return await authManager.authenticateSupabase()
            }

            // Check if session is expired or close to expiring
            const now = Math.floor(Date.now() / 1000)
            const expiresAt = session.expires_at || 0
            const timeUntilExpiry = expiresAt - now

            if (timeUntilExpiry <= 60) { // If expires in 1 minute or less
                console.log('⏰ Supabase session expired or expiring soon, re-authenticating')
                await supabaseClient.auth.signOut()
                return await authManager.authenticateSupabase()
            }

            console.log('✅ Supabase session is valid and emails match')
            setSupabaseUser(session.user)
            // Don't set loading=false here - let the effect that depends on both users handle it
            return true

        } catch (err: any) {
            console.error('❌ Error checking Supabase session:', err)
            // Re-authenticate on any error
            return await authManager.authenticateSupabase()
        }
    }

    // SINGLE SOURCE OF TRUTH: Firebase auth state drives everything
    useEffect(() => {
        let mounted = true
        let currentFirebaseUser: User | null = null // Track current Firebase user

        const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
            console.log('🔥 Firebase auth state changed (SOURCE OF TRUTH):', !!firebaseUser, firebaseUser?.email)

            if (!mounted) return

            currentFirebaseUser = firebaseUser // Update tracked user

            if (firebaseUser) {
                // Firebase user exists - ensure Supabase matches
                setUser(firebaseUser)
                setError(null)
                // Keep loading=true until Supabase auth is also complete

                try {
                    console.log('🔐 Firebase user authenticated, ensuring Supabase sync...')
                    await ensureSupabaseAuth(firebaseUser)
                    // Don't set loading=false here - let Supabase auth events handle it
                } catch (error) {
                    console.error('❌ Failed to sync Supabase with Firebase:', error)
                    setError(error instanceof Error ? error.message : 'Authentication sync failed')
                    setIsLoading(false) // Only clear loading on error
                }
            } else {
                // No Firebase user - clear everything
                console.log('🚪 No Firebase user, signing out of Supabase')
                setUser(null)
                setSupabaseUser(null)
                setError(null)
                setIsLoading(false)

                // Ensure Supabase is signed out
                await supabaseClient.auth.signOut()
                authManager.reset()
            }
        })

        // Listen for Supabase auth state changes (but Firebase is still the authority)
        const {
            data: { subscription },
        } = supabaseClient.auth.onAuthStateChange(async (event, session) => {
            console.log('🟦 Supabase auth event:', event, !!session?.user)

            if (!mounted) return

            // Only update Supabase user state, don't drive the main auth flow
            if (event === 'SIGNED_IN' && session?.user) {
                // Validate email match with current Firebase user (use tracked user, not state)
                if (currentFirebaseUser && validateEmailMatch(currentFirebaseUser, session.user)) {
                    console.log('✅ Supabase signed in with matching email, updating state')
                    setSupabaseUser(session.user)
                    setIsLoading(false)
                } else if (currentFirebaseUser) {
                    console.log('🚨 Supabase signed in with different email, signing out Firebase to prevent loop')
                    setError(`Email mismatch: Firebase(${currentFirebaseUser.email}) !== Supabase(${session.user.email})`)
                    setIsLoading(false)
                    // Sign out Firebase to break the loop
                    await auth.signOut()
                } else {
                    console.log('⚠️ Supabase signed in but no Firebase user yet')
                }
            } else if (event === 'SIGNED_OUT') {
                setSupabaseUser(null)
            } else if (event === 'TOKEN_REFRESHED' && session?.user) {
                // Validate email match on token refresh (use tracked user, not state)
                if (currentFirebaseUser && validateEmailMatch(currentFirebaseUser, session.user)) {
                    setSupabaseUser(session.user)
                } else if (currentFirebaseUser) {
                    console.log('🚨 Token refreshed with different email, signing out Firebase to prevent loop')
                    setError(`Email mismatch on refresh: Firebase(${currentFirebaseUser.email}) !== Supabase(${session.user.email})`)
                    await auth.signOut()
                }
            }
        })

        return () => {
            mounted = false
            unsubscribeAuth()
            subscription.unsubscribe()
        }
    }, []) // Run only once

    // Watch for both users to be ready and clear loading state
    useEffect(() => {
        console.log('🔄 Auth state check - Firebase:', !!user, 'Supabase:', !!supabaseUser, 'Loading:', isLoading)

        // If we have both users and we're still loading, clear the loading state
        if (user && supabaseUser && isLoading) {
            console.log('✅ Both auth systems ready, clearing loading state')
            setIsLoading(false)
        }
    }, [user, supabaseUser, isLoading])

    return (
        <AuthContext.Provider value={{ user, supabaseUser, isLoading, error, signOut }}>
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