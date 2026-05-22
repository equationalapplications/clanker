import { getCurrentUser } from '../config/firebaseConfig'
import { getUserState } from '../services/apiClient'

export interface UserCredits {
  totalCredits: number
  nextExpiryDate: string | null
}

export const getUserCredits = async (): Promise<UserCredits> => {
  if (!getCurrentUser()) {
    return { totalCredits: 0, nextExpiryDate: null }
  }

  try {
    const state = await getUserState()

    if (!state?.subscription) {
      return { totalCredits: 0, nextExpiryDate: null }
    }

    return {
      totalCredits: Math.max(0, state.subscription.currentCredits),
      nextExpiryDate: state.subscription.nextExpiryDate ?? null,
    }
  } catch (error) {
    console.error('Error checking user credits:', error)
    return { totalCredits: 0, nextExpiryDate: null }
  }
}


