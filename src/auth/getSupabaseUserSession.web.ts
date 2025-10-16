// Web version - uses Firebase Web SDK
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '~/config/firebaseConfig'
import type { Session } from '@supabase/supabase-js'

export async function getSupabaseUserSession() {
    const currentUser = auth.currentUser
    if (!currentUser) {
        throw new Error('No Firebase user is currently signed in')
    }

    console.log('🔐 Starting Supabase authentication for Firebase user:', currentUser.email)

    const exchangeToken = httpsCallable(functions._instance, 'exchangeToken')
    console.log('Callable function reference created')

    try {
        console.log('Calling Firebase function with region us-central1')

        // Get the token response from Firebase function
        // The server will identify the app from the request origin header
        const response = await exchangeToken()
        console.log('Firebase function response:', response.data)
        return response.data as Session
    } catch (err: any) {
        console.error('Authentication failed:', err)
        throw new Error('Failed to authenticate: ' + (err.message || err))
    }
}
