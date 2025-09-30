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
        if (this.authInProgress || this.authCompleted) {
            console.log('Authentication already in progress or completed, skipping')
            return this.authCompleted
        }

        this.authInProgress = true
        console.log('🔐 SINGLETON: Starting Supabase authentication after Firebase login')

        try {
            const { loginToSupabaseAfterFirebase } = await import('../utilities/loginToSupabaseAfterFirebase')
            const authResponse = await loginToSupabaseAfterFirebase()

            if (authResponse?.data?.user) {
                console.log('✅ SINGLETON: Successfully authenticated with both Firebase and Supabase')
                this.authCompleted = true
                return true
            }
            return false
        } catch (err: any) {
            console.error('❌ SINGLETON: Supabase authentication failed:', err)
            throw err
        } finally {
            this.authInProgress = false
        }
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