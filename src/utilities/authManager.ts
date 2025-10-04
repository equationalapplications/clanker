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

    async authenticateSupabase(): Promise<boolean> {
        this.authInProgress = true
        console.log('🔐 SINGLETON: Starting Supabase authentication/re-authentication')

        try {
            const { loginToSupabaseAfterFirebase } = await import('../utilities/loginSupabase')
            console.log('🔐 SINGLETON: Calling loginToSupabaseAfterFirebase...')
            const data = await loginToSupabaseAfterFirebase()

            if (data?.session) {
                console.log('✅ SINGLETON: Successfully authenticated with Supabase')
                this.authCompleted = true
                return true
            }

            console.log('❌ SINGLETON: No user returned from Supabase auth')
            this.authCompleted = false
            return false
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
    async forceReAuthenticate(): Promise<boolean> {
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