import { getSupabaseUserSession } from './getSupabaseUserSession'

type SupabaseSession = Awaited<ReturnType<typeof getSupabaseUserSession>>

// Promise-deduplication wrapper: if an exchangeToken call is already in flight,
// subsequent callers receive the same promise instead of starting a second request.
let authInFlight: Promise<SupabaseSession> | null = null

export const authManager = {
  async authenticateSupabase(): Promise<SupabaseSession> {
    if (authInFlight) {
      console.log('🔐 AUTH: Deduplicating concurrent auth call, reusing in-flight promise')
      return authInFlight
    }

    console.log('🔐 AUTH: Starting Supabase authentication')
    authInFlight = getSupabaseUserSession()
      .then((session) => {
        console.log('✅ AUTH: Successfully authenticated with Supabase')
        return session
      })
      .catch((err: any) => {
        console.error('❌ AUTH: Error details:', { message: err?.message, name: err?.name })
        throw err
      })
      .finally(() => {
        authInFlight = null
      })

    return authInFlight
  },

  reset() {
    authInFlight = null
    console.log('🔄 AUTH: Authentication state reset')
  },
}
