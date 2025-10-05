import { supabaseClient } from '../config/supabaseClient'

/**
 * Grant app access to a user by creating a free tier subscription with terms acceptance
 * This will:
 * 1. Create a free subscription in user_app_subscriptions table
 * 2. Record terms acceptance date and version
 * 3. Trigger JWT refresh with new custom claims (plans array)
 */
export async function grantAppAccess(
    appName: string = 'yours-brightly',
    termsVersion: string = '1.0'
): Promise<{ success: boolean; error?: string }> {
    try {
        console.log(`Granting ${appName} access to user via free subscription with terms acceptance`)

        // Get current user
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()

        if (userError || !user) {
            throw new Error('No authenticated user found')
        }

        // Create a free subscription entry with terms acceptance
        const { data, error } = await supabaseClient
            .from('user_app_subscriptions')
            .upsert({
                user_id: user.id,
                app: appName,
                plan: 'free',
                status: 'active',
                credits_balance: 50, // Free tier gets 50 credits
                billing_cycle_start: new Date().toISOString(),
                billing_cycle_end: null, // Free tier doesn't expire
                terms_accepted: true,
                terms_accepted_at: new Date().toISOString(), // Record terms acceptance
                terms_version: termsVersion,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,app'
            })

        if (error) {
            throw error
        }

        console.log(`Successfully granted ${appName} access via free subscription with terms acceptance`)

        // Refresh the session to get updated JWT claims with new subscription
        const { error: refreshError } = await supabaseClient.auth.refreshSession()

        if (refreshError) {
            console.warn('Failed to refresh session after granting access:', refreshError)
        } else {
            console.log('Session refreshed with new subscription claims')
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
 * Check if user has access to a specific app via JWT plans system
 * Returns true if user has any active subscription for the app
 */
export async function checkAppAccess(appName: string = 'yours-brightly'): Promise<boolean> {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession()

        if (!session?.access_token) {
            console.log('checkAppAccess: No session or access token found')
            return false
        }

        // Parse the JWT to check custom claims (plans array)
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const plans = payload.plans || []

        console.log('checkAppAccess: JWT payload analysis', {
            appName,
            plans,
            hasPlans: !!payload.plans,
            plansType: typeof payload.plans,
            plansCount: plans.length
        })

        // Check if user has any active plan for this app
        const hasAccess = plans.some((plan: any) =>
            plan.app === appName && plan.status === 'active'
        )

        console.log(`checkAppAccess: User ${hasAccess ? 'has' : 'does not have'} access to ${appName}`)
        return hasAccess
    } catch (error) {
        console.error('Error checking app access:', error)
        return false
    }
}

/**
 * Check if user has accepted terms for a specific app
 * Returns the terms acceptance status and date
 */
export async function checkTermsAcceptance(appName: string = 'yours-brightly'): Promise<{
    hasAccepted: boolean;
    acceptedAt?: string;
    termsVersion?: string;
}> {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession()

        if (!session?.access_token) {
            console.log('checkTermsAcceptance: No session found')
            return { hasAccepted: false }
        }

        // Parse the JWT to check plans array
        const payload = JSON.parse(atob(session.access_token.split('.')[1]))
        const plans = payload.plans || []

        // Find the plan for this app
        const appPlan = plans.find((plan: any) => plan.app === appName)

        if (!appPlan) {
            console.log(`checkTermsAcceptance: No subscription found for ${appName}`)
            return { hasAccepted: false }
        }

        // Check if terms have been accepted (terms_accepted field exists and is not null)
        const hasAccepted = !!appPlan.terms_accepted

        console.log(`checkTermsAcceptance: User ${hasAccepted ? 'has' : 'has not'} accepted terms for ${appName}`, {
            termsAccepted: appPlan.terms_accepted,
            status: appPlan.status
        })

        return {
            hasAccepted,
            acceptedAt: appPlan.terms_accepted,
            termsVersion: appPlan.terms_version // Note: we don't include terms_version in JWT, would need DB query
        }
    } catch (error) {
        console.error('Error checking terms acceptance:', error)
        return { hasAccepted: false }
    }
}

/**
 * Get user's subscription data from the database
 */
export async function getUserAppSubscriptions(): Promise<{
    success: boolean
    subscriptions?: any[]
    error?: string
}> {
    try {
        const { data, error } = await supabaseClient
            .from('user_app_subscriptions')
            .select('*')

        if (error) {
            throw error
        }

        return { success: true, subscriptions: data }
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