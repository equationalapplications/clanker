import { useEffect, useState } from 'react'
import { User } from 'firebase/auth'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { useUser } from './useUser'
import { supabase } from '../config/supabaseClient'
import { loginToSupabaseAfterFirebase } from '../utilities/loginToSupabaseAfterFirebase'

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
                } else if (session?.user && mounted) {
                    console.log('Found existing Supabase session on mount:', session.user.id)
                    setSupabaseUser(session.user)
                }
            } catch (err) {
                console.error('Failed to check existing session:', err)
            }
        }

        const authenticateWithSupabase = async () => {
            if (!firebaseUser || supabaseUser) return

            setIsLoading(true)
            setError(null)

            try {
                console.log('Starting Supabase authentication after Firebase login')
                const authResponse = await loginToSupabaseAfterFirebase()

                if (mounted && authResponse?.data?.user) {
                    setSupabaseUser(authResponse.data.user)
                    console.log('Successfully authenticated with both Firebase and Supabase')
                }
            } catch (err: any) {
                console.error('Supabase authentication failed:', err)
                if (mounted) {
                    setError(err.message || 'Failed to authenticate with Supabase')
                }
            } finally {
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
                    } else {
                        console.log('No initial Supabase session found')
                        setSupabaseUser(null)
                    }
                } else if (event === 'SIGNED_IN') {
                    console.log('Supabase user signed in:', session?.user?.id)
                    setSupabaseUser(session?.user ?? null)
                    setError(null) // Clear any previous errors
                } else if (event === 'SIGNED_OUT') {
                    console.log('Supabase user signed out')
                    setSupabaseUser(null)
                } else if (event === 'TOKEN_REFRESHED') {
                    console.log('Supabase token refreshed for user:', session?.user?.id)
                    setSupabaseUser(session?.user ?? null)
                }
            }
        })

        // Check for existing session on mount
        checkExistingSession()

        // Trigger authentication when Firebase user is available
        if (firebaseUser && !supabaseUser && !isLoading) {
            authenticateWithSupabase()
        }

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [firebaseUser, supabaseUser, isLoading])

    // Clear Supabase user when Firebase user logs out
    useEffect(() => {
        if (!firebaseUser && supabaseUser) {
            supabase.auth.signOut()
            setSupabaseUser(null)
            setError(null)
        }
    }, [firebaseUser, supabaseUser])

    return {
        firebaseUser,
        supabaseUser,
        isLoading,
        error,
    }
}