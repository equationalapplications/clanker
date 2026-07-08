import { appCheckReady, exchangeToken, getCurrentUser } from '~/config/firebaseConfig'
import { DEV_CLOUD_CHARACTER_ID } from '../../shared/dev-sandbox'
import { ensureDevSandboxCharacter } from '~/auth/ensureDevSandboxCharacter'
import { isDevSandboxEnabled } from '~/auth/devSandboxFlag'

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

export type BootstrapResponse = BootstrapSessionResult

const mockBootstrapUserId = '11111111-1111-4111-8111-111111111111'
const mockBootstrapFirebaseUid = 'local_test_user_123'
const mockBootstrapEmail = 'dev@localhost.com'
const mockBootstrapCurrentCredits = 5000
const mockBootstrapPlanTier = 'free'
const mockBootstrapPlanStatus = 'active'
const mockBootstrapTermsVersion = null

const bootstrapSessionPromises = new Map<string, Promise<BootstrapSessionResult>>()

const BOOTSTRAP_MAX_RETRIES = 2
const BOOTSTRAP_RETRY_DELAY_MS = 750

function normalizeBootstrapResponse(response: {
  user: any
  subscription: any
}): BootstrapSessionResult {
  if (typeof response.user.createdAt !== 'string' || typeof response.user.updatedAt !== 'string') {
    throw new Error('Invalid bootstrap response: missing or invalid user timestamps')
  }

  if (
    typeof response.user.id !== 'string' ||
    typeof response.user.firebaseUid !== 'string' ||
    typeof response.user.email !== 'string'
  ) {
    throw new Error('Invalid bootstrap response: missing or invalid required user fields')
  }

  const user: UserSnapshot = {
    id: response.user.id,
    firebaseUid: response.user.firebaseUid,
    email: response.user.email,
    displayName: response.user.displayName ?? null,
    avatarUrl: response.user.avatarUrl ?? null,
    isProfilePublic: response.user.isProfilePublic ?? false,
    defaultCharacterId: response.user.defaultCharacterId ?? null,
    createdAt: response.user.createdAt,
    updatedAt: response.user.updatedAt,
  }

  const subscription: SubscriptionSnapshot = {
    planTier: response.subscription.planTier ?? null,
    planStatus: response.subscription.planStatus ?? null,
    currentCredits: response.subscription.currentCredits ?? 0,
    grantedTotal: response.subscription.grantedTotal ?? 0,
    termsVersion: response.subscription.termsVersion ?? null,
    termsAcceptedAt: response.subscription.termsAcceptedAt ?? null,
    nextExpiryDate: response.subscription.nextExpiryDate ?? null,
    cancelAtPeriodEnd: response.subscription.cancelAtPeriodEnd ?? false,
  }

  return {
    user,
    subscription,
  }
}

async function buildMockBootstrap(): Promise<BootstrapSessionResult> {
  let defaultCharacterId = DEV_CLOUD_CHARACTER_ID
  try {
    const ensured = await ensureDevSandboxCharacter(mockBootstrapFirebaseUid)
    if (ensured) {
      defaultCharacterId = ensured
    }
  } catch (error) {
    console.warn('bootstrapSession: mock auth character provisioning failed', error)
  }

  const now = new Date().toISOString()
  return {
    user: {
      id: mockBootstrapUserId,
      firebaseUid: mockBootstrapFirebaseUid,
      email: mockBootstrapEmail,
      displayName: null,
      avatarUrl: null,
      isProfilePublic: false,
      defaultCharacterId,
      createdAt: now,
      updatedAt: now,
    },
    subscription: {
      planTier: mockBootstrapPlanTier,
      planStatus: mockBootstrapPlanStatus,
      currentCredits: mockBootstrapCurrentCredits,
      grantedTotal: mockBootstrapCurrentCredits,
      termsVersion: mockBootstrapTermsVersion,
      termsAcceptedAt: null,
      nextExpiryDate: null,
      cancelAtPeriodEnd: false,
    },
  }
}

export async function bootstrapSession(): Promise<BootstrapSessionResult> {
  const currentUser = getCurrentUser()
  const currentUserId = currentUser?.uid ?? null
  const cacheKey = isDevSandboxEnabled() ? DEV_CLOUD_CHARACTER_ID : currentUserId ?? 'anonymous'

  if (bootstrapSessionPromises.has(cacheKey)) {
    return bootstrapSessionPromises.get(cacheKey) as Promise<BootstrapSessionResult>
  }

  const bootstrapPromise = (async (): Promise<BootstrapSessionResult> => {
    if (isDevSandboxEnabled()) {
      return buildMockBootstrap()
    }

    if (!currentUserId) {
      throw new Error('No authenticated user available for bootstrapSession')
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= BOOTSTRAP_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_DELAY_MS * attempt))
      }

      try {
        // exchangeToken has enforceAppCheck: true — wait for App Check init
        // before calling it, same as every other callable-function caller.
        await appCheckReady

        const response = (await exchangeToken()) as {
          data: {
            user: any
            subscription: any
          }
        }

        if (!response?.data?.user || !response?.data?.subscription) {
          throw new Error('Invalid exchange token response')
        }

        return normalizeBootstrapResponse(response.data)
      } catch (err) {
        lastError = err
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  })()

  bootstrapSessionPromises.set(cacheKey, bootstrapPromise)

  try {
    return await bootstrapPromise
  } finally {
    bootstrapSessionPromises.delete(cacheKey)
  }
}
