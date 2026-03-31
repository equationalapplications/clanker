import { supabaseClient } from '../config/supabaseClient'
import { getCurrentUser, spendCreditsFn } from '../config/firebaseConfig'
import { APP_NAME, SUBSCRIPTION_TIERS } from '../config/constants'
import { getSupabaseUserId } from './getSupabaseUserId'

interface UserCredits {
  totalCredits: number
  hasUnlimited: boolean
  subscriptions: {
    tier: string
    credits: number
    isUnlimited: boolean
  }[]
}

export const getUserCredits = async (): Promise<UserCredits> => {
  if (!getCurrentUser()) {
    console.log('📊 getUserCredits: No Firebase user')
    return {
      totalCredits: 0,
      hasUnlimited: false,
      subscriptions: [],
    }
  }

  try {
    const supabaseUserId = await getSupabaseUserId()

    if (!supabaseUserId) {
      console.error('❌ getUserCredits: Error getting Supabase user')
      return {
        totalCredits: 0,
        hasUnlimited: false,
        subscriptions: [],
      }
    }

    console.log('📊 getUserCredits: Querying with Supabase UUID:', supabaseUserId)

    // Query all active subscriptions and credit records for the user
    const { data: subscriptions, error } = await supabaseClient
      .from('user_app_subscriptions')
      .select('plan_tier, current_credits, plan_status')
      .eq('user_id', supabaseUserId)
      .eq('app_name', APP_NAME)
      .eq('plan_status', 'active')

    console.log('📊 getUserCredits: Query result:', {
      subscriptions,
      error,
      count: subscriptions?.length || 0,
    })

    if (error) {
      console.error('Error fetching user credits:', error)
      return {
        totalCredits: 0,
        hasUnlimited: false,
        subscriptions: [],
      }
    }

    let totalCredits = 0
    let hasUnlimited = false
    const subscriptionDetails: {
      tier: string
      credits: number
      isUnlimited: boolean
    }[] = []

    for (const sub of subscriptions || []) {
      const credits = sub.current_credits || 0
      const isUnlimited = SUBSCRIPTION_TIERS.includes(sub.plan_tier)

      subscriptionDetails.push({
        tier: sub.plan_tier,
        credits,
        isUnlimited,
      })

      if (isUnlimited) {
        hasUnlimited = true
      } else {
        totalCredits += credits
      }
    }

    // If user has no subscriptions, they get 50 free credits on first login
    if (subscriptions.length === 0) {
      console.log('🆕 getUserCredits: No subscriptions found, creating initial free credits')
      // TODO: Wire up server-side initialize_free_tier_subscription() DB function
      // Free tier initialization should be handled server-side to avoid client-side writes.
      console.log('✅ getUserCredits: Returning 50 free credits')
      return {
        totalCredits: 50,
        hasUnlimited: false,
        subscriptions: [
          {
            tier: 'free',
            credits: 50,
            isUnlimited: false,
          },
        ],
      }
    }

    console.log('✅ getUserCredits: Returning credits:', {
      totalCredits,
      hasUnlimited,
      subscriptionCount: subscriptionDetails.length,
    })
    return {
      totalCredits,
      hasUnlimited,
      subscriptions: subscriptionDetails,
    }
  } catch (error) {
    console.error('Error checking user credits:', error)
    return {
      totalCredits: 0,
      hasUnlimited: false,
      subscriptions: [],
    }
  }
}

/**
 * Deduct credits from user's account via server-side Cloud Function.
 * This calls the spendCredits Cloud Function which uses the secure
 * spend_user_credits DB function with service_role access.
 * @param amount - Number of credits to deduct
 * @param description - Description of the spend (e.g. 'image_generation')
 * @param referenceId - Optional reference ID for tracking
 * @returns Promise<boolean> - Success status
 */
export const deductCredits = async (
  amount: number,
  description: string = 'credit_spend',
  referenceId?: string
): Promise<boolean> => {
  if (!getCurrentUser()) {
    return false
  }

  try {
    const result = await spendCreditsFn({ amount, description, referenceId })
    const data = result.data as { success?: boolean }
    console.log('✅ deductCredits: Server-side spend result:', data)
    return data?.success === true
  } catch (error) {
    console.error('❌ deductCredits: Error calling spendCredits:', error)
    return false
  }
}


