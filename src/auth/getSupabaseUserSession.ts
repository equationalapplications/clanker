import { getCurrentUser, exchangeToken } from '~/config/firebaseConfig'
import type { Session } from '@supabase/supabase-js'

export async function getSupabaseUserSession() {
    const user = getCurrentUser()
    if (!user) {
        throw new Error('No Firebase user is currently signed in')
    }

    try {
        console.log('Calling Firebase function with region us-central1')

        // Get the token response from Firebase function
        // Pass appName to identify which app to authenticate for
        const response = await exchangeToken({ appName: 'yours-brightly' })
        console.log('Firebase function response:', response.data)
        return response.data as Session
    } catch (err: any) {
        console.error('Authentication failed:', err)
        throw new Error('Failed to authenticate: ' + (err.message || err))
    }
}
