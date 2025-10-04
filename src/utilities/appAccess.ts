import { supabaseClient } from '../config/supabaseClient'

/**
 * Grant app access to a user by creating a free tier subscription
 * This will:
 * 1. Create a free subscription in user_app_subscriptions table
 * 2. Trigger JWT refresh with new custom claims (plans array)
 */
export async function grantAppAccess(
    appName: string = 'yours-brightly'
): Promise<{ success: boolean; error?: string }> {
    try {
        console.log(`Granting ${appName} access to user via free subscription`)

        // Get current user
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

        if (userError || !user) {
            throw new Error('No authenticated user found')
        }

        // Create a free subscription entry instead of using legacy permissions
        const { data, error } = await supabaseClient
            .from('user_app_subscriptions')
            .upsert({
                user_id: user.id,
                app_name: appName,
                plan_tier: 'free',
                plan_status: 'active',
                credits_remaining: 10, // Free tier gets 10 credits
                plan_starts_at: new Date().toISOString(),
                plan_renewal_at: null, // Free tier doesn't expire
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,app_name'
            })

        if (error) {
            throw error
        }

        console.log(`Successfully granted ${appName} access via free subscription`)

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
 * Check if user has access to a specific app via plans system
 */
export async function checkAppAccess(appName: string = 'yours-brightly'): Promise<boolean> {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession()

        if (!session?.access_token) {
            console.log('checkAppAccess: No session or access token found')
            return false
        }

        // Parse the JWT to check custom claims (plans only)
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const plans = payload.plans || []

        console.log('checkAppAccess: JWT payload analysis', {
            appName,
            plans,
            hasPlans: !!payload.plans,
            plansType: typeof payload.plans,
            plansCount: plans.length,
            fullPayload: payload
        })

        // Check if user has any plan for this app
        return plans.some((plan: any) => plan.app === appName)
    } catch (error) {
        console.error('Error checking app access:', error)
        return false
    }
}

/**
 * Get user's subscription data from the database
 */
export async function getUserAppPermissions(): Promise<{
    success: boolean
    permissions?: any[]
    error?: string
}> {
    try {
        const { data, error } = await supabaseClient
            .from('user_app_subscriptions')
            .select('*')

        if (error) {
            throw error
        }

        return { success: true, permissions: data }
    } catch (error: any) {
        console.error('Failed to get user subscriptions:', error)
        return {
            success: false,
            error: error.message || 'Failed to get subscriptions'
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