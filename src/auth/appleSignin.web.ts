// Web-specific Apple Sign-In implementation
import { OAuthProvider, getAuth, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'

export interface AppleSignInResult {
    success: boolean
    error?: string
}

const auth = getAuth(firebaseApp)
const appleProvider = new OAuthProvider('apple.com')
appleProvider.addScope('email')
appleProvider.addScope('name')

export const signInWithApple = async (): Promise<AppleSignInResult> => {
    try {
        console.log('🔐 Attempting Apple Sign-In via Firebase popup...')
        await signInWithPopup(auth, appleProvider)
        console.log('✅ Apple Sign-In successful via popup')
        return { success: true }
    } catch (popupError: any) {
        console.log('⚠️ Apple popup sign-in failed:', popupError.code)

        if (popupError.code === 'auth/popup-closed-by-user') {
            return { success: false, error: 'Sign-in cancelled' }
        }

        if (popupError.code === 'auth/popup-blocked') {
            console.log('🔄 Popup blocked, falling back to redirect...')
            try {
                await signInWithRedirect(auth, appleProvider)
                // signInWithRedirect navigates away; result is handled on return via getRedirectResult
                return { success: true }
            } catch (redirectError: any) {
                console.error('Apple redirect sign-in failed:', redirectError)
                return { success: false, error: redirectError.message || 'Redirect sign-in failed' }
            }
        }

        return { success: false, error: popupError.message || 'Apple Sign-In failed' }
    }
}

// No-op on web — Firebase auth handles sign-out
export const signOutFromApple = async (): Promise<void> => {
    // no-op
}

// Finalizes a pending Apple redirect sign-in. Call on sign-in screen mount
// so that auth/popup-blocked redirect flows reliably complete and errors surface.
export const handleAppleRedirectResult = async (): Promise<void> => {
    try {
        const result = await getRedirectResult(auth)
        if (result) {
            console.log('✅ Apple Sign-In redirect completed successfully')
        }
    } catch (error: any) {
        console.error('Apple redirect sign-in failed:', error)
    }
}
