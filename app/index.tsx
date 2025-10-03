import { Redirect } from "expo-router"
import { useAuth } from "../src/hooks/useAuth"

export default function Index() {
    const { user, isLoading } = useAuth()

    // Don't redirect while still loading auth state
    if (isLoading) {
        console.log('🏠 Index page - waiting for auth to resolve...')
        return null
    }

    const destination = user ? "/characters" : "/sign-in"
    console.log('🏠 Index page rendering - user:', !!user, 'redirecting to:', destination)

    return <Redirect href={destination} />
}