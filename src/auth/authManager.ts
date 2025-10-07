// Singleton authentication manager to prevent multiple auth attempts
class AuthenticationManager {
    private static instance: AuthenticationManager
    private authInProgress = false
    private authCompleted = false

    static getInstance(): AuthenticationManager {
        if (!AuthenticationManager.instance) {
            AuthenticationManager.instance = new AuthenticationManager()
        }
        return AuthenticationManager.instance
    }

    async authenticateSupabase() {
        this.authInProgress = true
        console.log('🔐 SINGLETON: Starting Supabase authentication/re-authentication')

        try {
            const { getSupabaseUserSession } = await import('./getSupabaseUserSession')
            console.log('🔐 SINGLETON: Calling getSupabaseUserSession...')
            const session = await getSupabaseUserSession()
            console.log('🔐 SINGLETON: Received Supabase session:', session)
            if (session) {
                console.log('✅ SINGLETON: Successfully authenticated with Supabase')
                this.authCompleted = true
                return session
            }

            console.log('❌ SINGLETON: No user session returned from Supabase auth')
            this.authCompleted = false
            throw new Error('No user returned from Supabase auth')
        } catch (err: any) {
            console.error('❌ SINGLETON: Error details:', {
                message: err?.message,
                stack: err?.stack,
                name: err?.name
            })
            this.authCompleted = false
            throw err
        } finally {
            this.authInProgress = false
        }
    }

    // Force re-authentication (for email mismatches or expired tokens)
    async forceReAuthenticate() {
        console.log('🔄 SINGLETON: Forcing re-authentication')
        this.reset()
        return await this.authenticateSupabase()
    }

    reset() {
        this.authInProgress = false
        this.authCompleted = false
        console.log('🔄 SINGLETON: Authentication state reset')
    }

    getStatus() {
        return {
            inProgress: this.authInProgress,
            completed: this.authCompleted
        }
    }
}

export const authManager = AuthenticationManager.getInstance()