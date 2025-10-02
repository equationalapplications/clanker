import { supabaseClient } from '../config/supabaseClient'

/**
 * Grant app access to a user when they accept terms and conditions
 * This will:
 * 1. Add the user to user_app_permissions table
 * 2. Create a record in the yours_brightly table
 * 3. Trigger JWT refresh with new custom claims
 */
export async function grantAppAccess(
    appName: string = 'yours-brightly',
    termsVersion?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        console.log(`Granting ${appName} access to user`)

        // Get current user
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

        if (userError || !user) {
            throw new Error('No authenticated user found')
        }

        // Call the database function to grant access
        const { data, error } = await supabaseClient.rpc('grant_app_access', {
            p_user_id: user.id,
            p_app_name: appName,
            p_terms_version: termsVersion
        })

        if (error) {
            throw error
        }

        console.log(`Successfully granted ${appName} access`)

        // Refresh the session to get updated JWT claims
        const { error: refreshError } = await supabaseClient.auth.refreshSession()

        if (refreshError) {
            console.warn('Failed to refresh session after granting access:', refreshError)
        } else {
            console.log('Session refreshed with new claims')
        }

        return { success: true }
    } catch (error: any) {
        console.error('Failed to grant app access:', error)
        return {
            success: false,
            error: error.message || 'Failed to grant app access'
        }
    }
}

/**
 * Check if user has access to a specific app
 */
export async function checkAppAccess(appName: string = 'yours-brightly'): Promise<boolean> {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession()

        if (!session?.access_token) {
            console.log('checkAppAccess: No session or access token found')
            return false
        }

        // Parse the JWT to check custom claims
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const apps = payload.apps || []

        console.log('checkAppAccess: JWT payload analysis', {
            appName,
            apps,
            hasApps: !!payload.apps,
            appsType: typeof payload.apps,
            includes: apps.includes(appName),
            fullPayload: payload
        })

        return apps.includes(appName)
    } catch (error) {
        console.error('Error checking app access:', error)
        return false
    }
}

/**
 * Get user's app permissions from the database
 */
export async function getUserAppPermissions(): Promise<{
    success: boolean
    permissions?: any[]
    error?: string
}> {
    try {
        const { data, error } = await supabaseClient
            .from('user_app_permissions')
            .select('*')

        if (error) {
            throw error
        }

        return { success: true, permissions: data }
    } catch (error: any) {
        console.error('Failed to get user app permissions:', error)
        return {
            success: false,
            error: error.message || 'Failed to get permissions'
        }
    }
}

/**
 * Get user's Yours Brightly profile data
 */
export async function getYoursBrightlyProfile(): Promise<{
    success: boolean
    profile?: any
    error?: string
}> {
    try {
        const { data, error } = await supabaseClient
            .from('yours_brightly')
            .select('*')
            .single()

        if (error) {
            throw error
        }

        return { success: true, profile: data }
    } catch (error: any) {
        console.error('Failed to get Yours Brightly profile:', error)
        return {
            success: false,
            error: error.message || 'Failed to get profile'
        }
    }
}