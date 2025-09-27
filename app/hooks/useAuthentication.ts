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
        } = supabase.auth.onAuthStateChange((event, session) => {
            if (mounted) {
                setSupabaseUser(session?.user ?? null)
                console.log('Supabase auth state changed:', event, !!session?.user)
            }
        })

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