import { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import { User } from 'firebase/auth'
import { auth } from '~/config/firebaseConfig'
import { authManager } from '~/utilities/authManager'
import { supabaseClient } from '~/config/supabaseClient'

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
    const [isLoading, setIsLoading] = useState(true) // Start with loading true

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

    // SINGLE SOURCE OF TRUTH: Firebase auth state drives everything
    useEffect(() => {
        const unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
            console.log('🔥 Firebase auth state changed (SOURCE OF TRUTH):', !!firebaseUser, firebaseUser?.email)

            if (firebaseUser) {
                setIsLoading(true)
                setUser(firebaseUser)

                try {
                    console.log('🔐 Firebase user authenticated, ensuring Supabase sync...')
                    await authManager.authenticateSupabase()
                    console.log('✅ Supabase sync complete.')
                } catch (error) {
                    console.error('❌ Failed to sync Supabase with Firebase:', error)
                    // Don't throw here, let the UI handle the unauthenticated state
                } finally {
                    setIsLoading(false)
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