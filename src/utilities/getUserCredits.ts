import { getCurrentUser, spendCreditsFn } from '../config/firebaseConfig'
import { PLAN_TIERS, SUBSCRIPTION_TIERS, type PlanTier } from '../config/constants'
import { getUserState } from '../services/apiClient'

interface UserCredits {
  totalCredits: number
  hasUnlimited: boolean
  subscriptions: {
    tier: string
    credits: number
    isUnlimited: boolean
  }[]
}

const ALL_PLAN_TIERS = Object.values(PLAN_TIERS)

const isPlanTier = (value: unknown): value is PlanTier => {
  return typeof value === 'string' && ALL_PLAN_TIERS.includes(value as PlanTier)
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
    const state = await getUserState()

    if (!state?.subscription) {
      console.error('❌ getUserCredits: Error getting user state')
      return {
        totalCredits: 0,
        hasUnlimited: false,
        subscriptions: [],
      }
    }

    const { planTier, planStatus, currentCredits } = state.subscription
    const isActive = planStatus === 'active'
    const isUnlimited =
      isActive && isPlanTier(planTier) && SUBSCRIPTION_TIERS.includes(planTier)

    const totalCredits = Math.max(0, currentCredits)

    return {
      totalCredits,
      hasUnlimited: isUnlimited,
      subscriptions: [{
        tier: planTier,
        credits: totalCredits,
        isUnlimited
      }],
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


