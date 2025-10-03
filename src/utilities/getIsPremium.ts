import { supabaseClient } from "../config/supabaseClient"
import { auth } from "../config/firebaseConfig"

export const getIsPremium = async (): Promise<boolean> => {
  if (!auth.currentUser) {
    return false
  }

  const uid = auth.currentUser.uid

  try {
    // Query Supabase for active subscriptions (excluding credits-only and free tiers)
    const { data: subscriptions, error } = await supabaseClient
      .from('user_app_subscriptions')
      .select('plan_tier, plan_status')
      .eq('user_id', uid)
      .eq('app_name', 'yours-brightly')
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
