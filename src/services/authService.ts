import { auth } from '../config/firebaseConfig'
import { supabase } from '../config/supabaseConfig'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebaseConfig'

/**
 * Authentication service that handles Firebase-to-Supabase integration
 */

// Firebase function to exchange Firebase token for Supabase token
const exchangeTokenFn = httpsCallable(functions, 'exchangeToken')

/**
 * Set up Firebase auth listener and sync with Supabase
 */
export const initializeAuthSync = () => {
    return auth.onAuthStateChanged(async (firebaseUser) => {
        if (firebaseUser) {
            try {
                // Exchange Firebase token for Supabase token
                const result = await exchangeTokenFn()
                const data = result.data as any

                if (data?.supabaseAccessToken) {
                    // Set the Supabase session with the token
                    const { error } = await supabase.auth.setSession({
                        access_token: data.supabaseAccessToken,
                        refresh_token: data.supabaseRefreshToken || '',
                    })

                    if (error) {
                        console.error('Error setting Supabase session:', error)
                    }
                }
            } catch (error) {
                console.error('Error exchanging tokens:', error)
            }
        } else {
            // User signed out, clear Supabase session
            await supabase.auth.signOut()
        }
    })
}

/**
 * Sign out from both Firebase and Supabase
 */
export const signOut = async () => {
    try {
        // Sign out from Firebase first
        await auth.signOut()

        // Sign out from Supabase
        await supabase.auth.signOut()
    } catch (error) {
        console.error('Error signing out:', error)
        throw error
    }
}

/**
 * Get current Firebase user
 */
export const getCurrentFirebaseUser = () => {
    return auth.currentUser
}

/**
 * Get current Supabase user
 */
export const getCurrentSupabaseUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    return user
}

/**
 * Check if user is authenticated in both Firebase and Supabase
 */
export const isAuthenticated = async (): Promise<boolean> => {
    const firebaseUser = getCurrentFirebaseUser()
    const supabaseUser = await getCurrentSupabaseUser()

    return !!(firebaseUser && supabaseUser)
}