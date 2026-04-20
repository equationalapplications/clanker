import { getCurrentUser, exchangeToken, appCheckReady } from '~/config/firebaseConfig'

export interface UserSnapshot {
  id: string
  firebaseUid: string
  email: string
  displayName: string | null
  avatarUrl: string | null
  isProfilePublic: boolean
  defaultCharacterId: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface SubscriptionSnapshot {
  planTier: string
  planStatus: string
  currentCredits: number
  termsVersion: string | null
  termsAcceptedAt: Date | string | null
}

export interface BootstrapResponse {
  user: UserSnapshot
  subscription: SubscriptionSnapshot
}

export async function bootstrapSession(): Promise<BootstrapResponse> {
  const user = getCurrentUser()
  if (!user) {
    throw new Error('No Firebase user is currently signed in')
  }

  try {
    // Ensure App Check is initialized before calling callable functions
    // that enforce App Check (exchangeToken has enforceAppCheck: true).
    await appCheckReady

    console.log('Calling bootstrap/exchangeToken function')

    // Get the bootstrap response from Firebase function
    const response = await exchangeToken()
    const data = response.data as BootstrapResponse
    
    console.log('Bootstrap response received', {
      userId: data?.user?.id,
      planTier: data?.subscription?.planTier,
      credits: data?.subscription?.currentCredits,
    })

    if (!data?.user || !data?.subscription) {
      throw new Error('Invalid bootstrap response: missing user or subscription data')
    }

    const createdAtValid =
      typeof data.user.createdAt === 'string' || data.user.createdAt instanceof Date
    const updatedAtValid =
      typeof data.user.updatedAt === 'string' || data.user.updatedAt instanceof Date

    if (!createdAtValid || !updatedAtValid) {
      throw new Error('Invalid bootstrap response: missing or invalid user timestamps')
    }

    return data
  } catch (err: any) {
    console.error('Bootstrap failed:', err)
    throw new Error('Failed to bootstrap session: ' + (err.message || err))
  }
}
