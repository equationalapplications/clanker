import { getCurrentUser, exchangeToken, appCheckReady } from '~/config/firebaseConfig'
import { APP_NAME } from '~/config/constants'

interface ExchangeTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export async function getSupabaseUserSession(): Promise<ExchangeTokenResponse> {
  const user = getCurrentUser()
  if (!user) {
    throw new Error('No Firebase user is currently signed in')
  }

  try {
    // Ensure App Check is initialized before calling callable functions
    // that enforce App Check (exchangeToken has enforceAppCheck: true).
    await appCheckReady

    console.log('Calling Firebase function with region us-central1')

    // Get the token response from Firebase function
    // Pass appName to identify which app to authenticate for
    const response = await exchangeToken({ appName: APP_NAME })
    const data = response.data as ExchangeTokenResponse
    console.log('Firebase function response received', {
      hasAccessToken: !!data?.access_token,
      hasRefreshToken: !!data?.refresh_token,
      expiresIn: data?.expires_in,
    })

    if (!data?.access_token || !data?.refresh_token) {
      throw new Error('Invalid session response: missing access_token or refresh_token')
    }

    return data
  } catch (err: any) {
    console.error('Authentication failed:', err)
    throw new Error('Failed to authenticate: ' + (err.message || err))
  }
}
