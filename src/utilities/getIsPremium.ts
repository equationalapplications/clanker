import { supabaseClient } from '../config/supabaseClient'
import { getCurrentUser } from '../config/firebaseConfig'

export const getIsPremium = async (): Promise<boolean> => {
  if (!getCurrentUser()) {
    return false
  }

  try {
    // Get the Supabase user ID (UUID format) not Firebase UID
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      console.error('Error getting Supabase user in getIsPremium:', userError)
      return false
    }

    const supabaseUserId = user.id

    // Query Supabase for active subscriptions (excluding credits-only and free tiers)
    const { data: subscriptions, error } = await supabaseClient
      .from('user_app_subscriptions')
      .select('plan_tier, plan_status')
      .eq('user_id', supabaseUserId)
      .eq('app_name', 'clanker')
      .eq('plan_status', 'active')
      .in('plan_tier', ['monthly_1000', 'monthly_unlimited']) // Only paid subscription tiers

    if (error) {
      console.error('Error fetching subscription data:', error)
      return false
    }

    // User has premium if they have any paid subscription (not just credits or free tier)
    return subscriptions && subscriptions.length > 0
  } catch (error) {
    console.error('Error checking premium status:', error)
    return false
  }
}
