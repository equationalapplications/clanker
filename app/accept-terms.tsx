import { useRouter, useLocalSearchParams } from 'expo-router'
import { AcceptTerms } from '../src/components/AcceptTerms'
import { authManager } from '../src/utilities/authManager'

export default function AcceptTermsModal() {
    const router = useRouter()
    const { isUpdate } = useLocalSearchParams()

    const handleAccepted = async () => {
        console.log('✅ Terms accepted, forcing re-authentication...')
        // Force re-authentication to get the updated JWT with new subscription
        await authManager.forceReAuthenticate()
        router.replace('/')
    }

    const handleCanceled = async () => {
        console.log('🚫 Terms declined, signing out...')
        // The AcceptTerms component handles signing out the user
        router.replace('/sign-in')
    }

    return (
        <AcceptTerms
            onAccepted={handleAccepted}
            onCanceled={handleCanceled}
            isUpdate={isUpdate === 'true'}
        />
    )
}