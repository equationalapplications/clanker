import { useEffect, useState } from 'react'
import { User } from 'firebase/auth'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { useUser } from './useUser'
import { supabase } from '../config/supabaseClient'
import { authManager } from '../utilities/authManager'

interface UseAuthenticationResult {
    firebaseUser: User | null
    supabaseUser: SupabaseUser | null
    isLoading: boolean
    error: string | null
}

export function useAuthentication(): UseAuthenticationResult {
    const firebaseUser = useUser()
    const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let mounted = true

        // Check for existing Supabase session on mount
        const checkExistingSession = async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession()
                if (error) {
                    console.error('Error checking existing Supabase session:', error)
                    if (mounted) {
                        setIsLoading(false)
                    }
                } else if (session?.user && mounted) {
                    console.log('Found existing Supabase session on mount:', session.user.id)
                    setSupabaseUser(session.user)
                    setIsLoading(false)
                } else if (mounted) {
                    console.log('No existing Supabase session found')
                    setIsLoading(false)
                }
            } catch (err) {
                console.error('Failed to check existing session:', err)
                if (mounted) {
                    setIsLoading(false)
                }
            }
        }

        // Listen for Supabase auth state changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Supabase auth state changed:', event, {
                hasSession: !!session,
                hasUser: !!session?.user,
                userId: session?.user?.id,
                expiresAt: session?.expires_at
            })

            if (mounted) {
                if (event === 'INITIAL_SESSION') {
                    // Check if we have a valid session
                    if (session?.user) {
                        console.log('Initial Supabase session found:', session.user.id)
                        setSupabaseUser(session.user)
                        setIsLoading(false) // Clear loading when session is found
                    } else {
                        console.log('No initial Supabase session found')
                        setSupabaseUser(null)
                        // Don't set loading to false here, as we might need to authenticate
                    }
                } else if (event === 'SIGNED_IN') {
                    console.log('Supabase user signed in:', session?.user?.id)
                    setSupabaseUser(session?.user ?? null)
                    setError(null) // Clear any previous errors
                    setIsLoading(false) // Clear loading when signed in
                } else if (event === 'SIGNED_OUT') {
                    console.log('Supabase user signed out')
                    setSupabaseUser(null)
                    setIsLoading(false) // Clear loading when signed out
                } else if (event === 'TOKEN_REFRESHED') {
                    console.log('Supabase token refreshed for user:', session?.user?.id)
                    setSupabaseUser(session?.user ?? null)
                    setIsLoading(false) // Clear loading when token refreshed
                }
            }
        })

        // Check for existing session on mount
        checkExistingSession()

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, []) // Run only on mount

    // Separate effect for triggering authentication when Firebase user becomes available
    useEffect(() => {
        const authenticateWithSupabase = async () => {
            // Check if conditions are met
            if (!firebaseUser || supabaseUser) return

            const status = authManager.getStatus()
            if (status.inProgress || status.completed) {
                console.log('Authentication already handled by singleton, skipping')
                return
            }

            setIsLoading(true)
            setError(null)

            try {
                await authManager.authenticateSupabase()
                // The Supabase auth state listener will handle setting supabaseUser
            } catch (err: any) {
                console.error('Supabase authentication failed:', err)
                setError(err.message || 'Failed to authenticate with Supabase')
            } finally {
                setIsLoading(false)
            }
        }

        // Trigger authentication when Firebase user is available
        authenticateWithSupabase()
    }, [firebaseUser]) // Only depend on firebaseUser, not on other state variables

    // Clear Supabase user when Firebase user logs out
    useEffect(() => {
        if (!firebaseUser && supabaseUser) {
            supabase.auth.signOut()
            setSupabaseUser(null)
            setError(null)
            authManager.reset() // Reset singleton state when user logs out
        }
    }, [firebaseUser, supabaseUser])

    return {
        firebaseUser,
        supabaseUser,
        isLoading,
        error,
    }
}