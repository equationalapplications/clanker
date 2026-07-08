import { exchangeToken } from '~/services/apiClient'
import type { FirebaseUser } from '~/config/firebaseConfig'

export interface UserSnapshot {
  id: string
  firebaseUid: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  isProfilePublic: boolean
  defaultCharacterId: string | null
  createdAt: string
  updatedAt: string
}

export interface SubscriptionSnapshot {
  planTier: string | null
  planStatus: string | null
  currentCredits: number
  grantedTotal: number
  termsVersion: string | null
  termsAcceptedAt: string | null
  nextExpiryDate: string | null
  cancelAtPeriodEnd: boolean
}

export interface BootstrapSessionResult {
  user: UserSnapshot
  subscription: SubscriptionSnapshot
}

export async function bootstrapSession(): Promise<BootstrapSessionResult> {
  try {
    const response = await exchangeToken()

    if (!response?.data?.user || !response?.data?.subscription) {
      throw new Error('Invalid exchange token response')
    }

    const { user, subscription } = response.data

    return {
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        email: user.email,
        displayName: user.displayName ?? null,
        avatarUrl: user.avatarUrl ?? null,
        isProfilePublic: user.isProfilePublic ?? false,
        defaultCharacterId: user.defaultCharacterId ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      subscription: {
        planTier: subscription.planTier ?? null,
        planStatus: subscription.planStatus ?? null,
        currentCredits: subscription.currentCredits ?? 0,
        grantedTotal: subscription.grantedTotal ?? 0,
        termsVersion: subscription.termsVersion ?? null,
        termsAcceptedAt: subscription.termsAcceptedAt ?? null,
        nextExpiryDate: subscription.nextExpiryDate ?? null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
      },
    }
  } catch (error) {
    // Dev sandbox fallback for local development without Firebase Functions
    if (__DEV__) {
      console.warn('bootstrapSession: using dev sandbox fallback', error)
      return {
        user: {
          id: 'dev-user-id',
          firebaseUid: 'dev-firebase-uid',
          email: 'dev@example.com',
          displayName: 'Dev User',
          avatarUrl: null,
          isProfilePublic: false,
          defaultCharacterId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        subscription: {
          planTier: 'free',
          planStatus: 'active',
          currentCredits: 5000,
          grantedTotal: 5000,
          termsVersion: '2.2',
          termsAcceptedAt: new Date().toISOString(),
          nextExpiryDate: null,
          cancelAtPeriodEnd: false,
        },
      }
    }
    throw error
  }
}
