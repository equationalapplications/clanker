import { getCurrentUser, exchangeToken, appCheckReady } from '~/config/firebaseConfig'

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
  planTier: string
  planStatus: string
  currentCredits: number
  termsVersion: string | null
  termsAcceptedAt: string | null
}

export interface BootstrapResponse {
  user: UserSnapshot
  subscription: SubscriptionSnapshot
}

type BootstrapInFlight = {
  uid: string
  promise: Promise<BootstrapResponse>
}

let bootstrapSessionInFlight: BootstrapInFlight | null = null

const BOOTSTRAP_MAX_RETRIES = 2
const BOOTSTRAP_RETRY_DELAY_MS = 750

async function runBootstrapSession(): Promise<BootstrapResponse> {
  const user = getCurrentUser()
  if (!user) {
    throw new Error('No Firebase user is currently signed in')
  }

  let lastError: unknown

  for (let attempt = 0; attempt <= BOOTSTRAP_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, BOOTSTRAP_RETRY_DELAY_MS * attempt))
      console.log(`Retrying bootstrap/exchangeToken (attempt ${attempt + 1}/${BOOTSTRAP_MAX_RETRIES + 1})`)
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

      const createdAtValid = typeof data.user.createdAt === 'string'
      const updatedAtValid = typeof data.user.updatedAt === 'string'

      if (!createdAtValid || !updatedAtValid) {
        throw new Error('Invalid bootstrap response: missing or invalid user timestamps')
      }

      return data
    } catch (err: any) {
      lastError = err
      console.error(`Bootstrap attempt ${attempt + 1} failed:`, err)
    }
  }

  const message = (lastError as any)?.message ?? String(lastError)
  console.error('Bootstrap failed after all retries:', lastError)
  throw new Error('Failed to bootstrap session: ' + message)
}

export async function bootstrapSession(): Promise<BootstrapResponse> {
  const user = getCurrentUser()
  if (!user) {
    throw new Error('No Firebase user is currently signed in')
  }

  const uid = user.uid

  if (bootstrapSessionInFlight?.uid === uid) {
    return await bootstrapSessionInFlight.promise
  }

  const promise = runBootstrapSession()
  bootstrapSessionInFlight = { uid, promise }

  try {
    return await promise
  } finally {
    if (bootstrapSessionInFlight?.uid === uid && bootstrapSessionInFlight.promise === promise) {
      bootstrapSessionInFlight = null
    }
  }
}
