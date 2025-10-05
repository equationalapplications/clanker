import { useRouter, useLocalSearchParams } from 'expo-router'
import { AcceptTerms } from '../src/components/AcceptTerms'

export default function AcceptTermsModal() {
    const router = useRouter()
    const { isUpdate } = useLocalSearchParams()

    const handleAccepted = () => {
        router.back()
    }

    const handleCanceled = () => {
        router.back()
        // Note: The AcceptTerms component handles signing out the user
    }

    return (
        <AcceptTerms
            onAccepted={handleAccepted}
            onCanceled={handleCanceled}
            isUpdate={isUpdate === 'true'}
        />
    )
}