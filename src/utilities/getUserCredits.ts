import { supabaseClient } from '../config/supabaseClient'
import { getCurrentUser } from '../config/firebaseConfig'

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
    // Get the Supabase user ID (UUID format) not Firebase UID
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      console.error('❌ getUserCredits: Error getting Supabase user:', userError)
      return {
        totalCredits: 0,
        hasUnlimited: false,
        subscriptions: [],
      }
    }

    const supabaseUserId = user.id
    console.log('📊 getUserCredits: Querying with Supabase UUID:', supabaseUserId)

    // Query all active subscriptions and credit records for the user
    const { data: subscriptions, error } = await supabaseClient
      .from('user_app_subscriptions')
      .select('plan_tier, current_credits, plan_status')
      .eq('user_id', supabaseUserId)
      .eq('app_name', 'clanker')
      .eq('plan_status', 'active')

    console.log('📊 getUserCredits: Query result:', { subscriptions, error, count: subscriptions?.length || 0 })

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
      const isUnlimited = sub.plan_tier === 'monthly_unlimited'

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
      // Check if we need to create initial free credits
      await ensureInitialFreeCredits(supabaseUserId)
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

    console.log('✅ getUserCredits: Returning credits:', { totalCredits, hasUnlimited, subscriptionCount: subscriptionDetails.length })
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

async function ensureInitialFreeCredits(uid: string): Promise<void> {
  try {
    console.log('🎁 ensureInitialFreeCredits: Creating free credits for user:', uid)

    // Create initial free credits record for new users
    const { data, error } = await supabaseClient.from('user_app_subscriptions').insert({
      user_id: uid,
      app_name: 'clanker',
      plan_tier: 'free',
      plan_status: 'active',
      current_credits: 50,
      billing_provider_id: 'initial_free_credits',
      billing_metadata: {
        type: 'initial_free_credits',
        created_at: new Date().toISOString(),
      },
    }).select()

    if (error) {
      console.error('❌ ensureInitialFreeCredits: Error creating initial free credits:', error)
      console.error('❌ ensureInitialFreeCredits: Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
    } else {
      console.log('✅ ensureInitialFreeCredits: Created initial 50 free credits:', data)
    }
  } catch (error) {
    console.error('❌ ensureInitialFreeCredits: Exception:', error)
  }
}

/**
 * Deduct credits from user's account
 * @param amount - Number of credits to deduct
 * @returns Promise<boolean> - Success status
 */
export const deductCredits = async (amount: number): Promise<boolean> => {
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
      console.error('Error getting Supabase user:', userError)
      return false
    }

    const supabaseUserId = user.id

    // First check if user has unlimited plan
    const { data: unlimitedSubs } = await supabaseClient
      .from('user_app_subscriptions')
      .select('plan_tier')
      .eq('user_id', supabaseUserId)
      .eq('app_name', 'clanker')
      .eq('plan_status', 'active')
      .eq('plan_tier', 'monthly_unlimited')
      .limit(1)

    if (unlimitedSubs && unlimitedSubs.length > 0) {
      // User has unlimited plan, no need to deduct credits
      console.log('User has unlimited plan, no credits deducted')
      return true
    }

    // Get all active subscriptions with credits
    const { data: subscriptions } = await supabaseClient
      .from('user_app_subscriptions')
      .select('id, plan_tier, current_credits')
      .eq('user_id', supabaseUserId)
      .eq('app_name', 'clanker')
      .eq('plan_status', 'active')
      .gt('current_credits', 0)
      .order('plan_tier', { ascending: true }) // Prioritize certain tiers if needed

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No credits available for deduction')
      return false
    }

    let remainingToDeduct = amount

    for (const sub of subscriptions) {
      if (remainingToDeduct <= 0) break

      const availableCredits = sub.current_credits || 0
      const toDeduct = Math.min(remainingToDeduct, availableCredits)
      const newCredits = availableCredits - toDeduct

      // Update the subscription with new credit amount
      const { error } = await supabaseClient
        .from('user_app_subscriptions')
        .update({
          current_credits: newCredits,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id)

      if (error) {
        console.error('Error updating credits:', error)
        return false
      }

      remainingToDeduct -= toDeduct
      console.log(`Deducted ${toDeduct} credits from ${sub.plan_tier}, remaining: ${newCredits}`)
    }

    return remainingToDeduct === 0
  } catch (error) {
    console.error('Error deducting credits:', error)
    return false
  }
}
