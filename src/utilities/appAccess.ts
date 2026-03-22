import { supabaseClient } from '../config/supabaseClient'
import { APP_NAME } from '../config/constants'

/**
 * Grant app access to a user by creating a free tier subscription with terms acceptance
 * This will:
 * 1. Create a free subscription in user_app_subscriptions table
 * 2. Record terms acceptance date and version
 * 3. Trigger JWT refresh with new custom claims (plans array)
 */
export async function grantAppAccess(
  appName: string = APP_NAME,
  termsVersion: string = '1.0',
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`Granting ${appName} access to user via free subscription with terms acceptance`)

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      throw new Error('No authenticated user found')
    }

    // Create a free subscription entry with terms acceptance
    // This is an optimistic write - we return success immediately
    // The mutation will complete in the background
    const { error } = await supabaseClient
      .from('user_app_subscriptions')
      .upsert(
        {
          user_id: user.id,
          app_name: appName,
          plan_tier: 'free',
          plan_status: 'active',
          current_credits: 50, // Free tier gets 50 credits
          terms_accepted_at: new Date().toISOString(), // Record terms acceptance
          terms_version: termsVersion,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,app_name',
        },
      )
      .select()

    if (error) {
      throw error
    }

    console.log(
      `Successfully granted ${appName} access via free subscription with terms acceptance`,
    )

    // Note: We don't force a JWT refresh here anymore
    // The next time the user's JWT expires and refreshes naturally,
    // it will pick up the new subscription from the database
    // For immediate access, we trust the client-side state

    return { success: true }
  } catch (error: any) {
    console.error('Failed to grant app access:', error)
    return {
      success: false,
      error: error.message || 'Failed to grant app access',
    }
  }
}

// DEPRECATED: checkAppAccess and checkTermsAcceptance (JWT-based) removed.
// Terms acceptance is now checked via direct DB query in useSubscriptionStatus hook.
// For DB-based terms checking, see checkTermsAcceptance in ~/services/userService.ts.

/**
 * Get user's subscription data from the database
 */
export async function getUserAppSubscriptions(): Promise<{
  success: boolean
  subscriptions?: any[]
  error?: string
}> {
  try {
    const { data, error } = await supabaseClient.from('user_app_subscriptions').select('*')

    if (error) {
      throw error
    }

    return { success: true, subscriptions: data }
  } catch (error: any) {
    console.error('Failed to get user subscriptions:', error)
    return {
      success: false,
      error: error.message || 'Failed to get subscriptions',
    }
  }
}

export async function getProfile(): Promise<{
  success: boolean
  profile?: any
  error?: string
}> {
  try {
    const { data, error } = await supabaseClient.from('profiles').select('*').single()

    if (error) {
      throw error
    }

    return { success: true, profile: data }
  } catch (error: any) {
    console.error('Failed to get profile:', error)
    return {
      success: false,
      error: error.message || 'Failed to get profile',
    }
  }
}
