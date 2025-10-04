import { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import { User } from 'firebase/auth'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { auth } from '../config/firebaseConfig'
import { authManager } from '../utilities/authManager'
import { supabaseClient } from '../config/supabaseClient'

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
    const [isLoading, setIsLoading] = useState(false)

    const signOut = async () => {
        try {
            setIsLoading(true)
            console.log('🧹 Signing out from Supabase...')
            await supabaseClient.auth.signOut()

            console.log('🔄 Resetting auth manager...')
            authManager.reset()

            console.log('🔥 Signing out from Firebase...')
            await auth.signOut()
            setUser(null)

            setIsLoading(false)
            console.log('✅ Sign-out process completed')
        } catch (error) {
            console.error('❌ Error signing out:', error)
            setIsLoading(false)
            throw new Error('Failed to sign out. Please try again.')
        }
    }

    // Validate that Supabase user email matches Firebase user email
    const validateEmailMatch = (firebaseUser: User, supabaseUser: SupabaseUser): boolean => {
        const firebaseEmail = firebaseUser.email?.toLowerCase()
        const supabaseEmail = supabaseUser.email?.toLowerCase()

        if (!firebaseEmail || !supabaseEmail) {
            console.warn('⚠️ Missing email in Firebase or Supabase user')
            throw new Error('Missing email in Firebase or Supabase user. Please try again.')
        }

        const emailsMatch = firebaseEmail === supabaseEmail
        console.log(`📧 Email validation: Firebase(${firebaseEmail}) === Supabase(${supabaseEmail}) = ${emailsMatch}`)
        return emailsMatch
    }

    // Ensure Supabase is authenticated with correct user
    const ensureSupabaseAuth = async (firebaseUser: User) => {
        try {
            const { data: { session }, error } = await supabaseClient.auth.getSession()

            if (error) {
                throw new Error(`Session error. Please try again.`)
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
            return true

        } catch (err: any) {
            console.error('❌ Error checking Supabase session:', err)
            // Re-authenticate on any error
            console.log('🔄 Calling authManager.authenticateSupabase() after error...')
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
                setIsLoading(true)
                setUser(firebaseUser)
                // Keep loading=true until Supabase auth is also complete

                try {
                    console.log('🔐 Firebase user authenticated, ensuring Supabase sync...')
                    await ensureSupabaseAuth(firebaseUser)
                    setIsLoading(false)
                    // Don't set loading=false here - let Supabase auth events handle it
                } catch (error) {
                    console.error('❌ Failed to sync Supabase with Firebase:', error)
                    setIsLoading(false) // Only clear loading on error
                    throw new Error('Failed to sync Supabase with Firebase. Please try again.')
                }
            } else {
                // No Firebase user - clear everything
                console.log('🚪 No Firebase user, signing out of Supabase')
                setUser(null)
                await supabaseClient.auth.signOut()
                authManager.reset()
                setIsLoading(false)
            }
        })

        return () => {
            mounted = false
            unsubscribeAuth()
        }
    }, []) // Run only once



    return (
        <AuthContext.Provider value={{ user, isLoading, signOut }}>
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