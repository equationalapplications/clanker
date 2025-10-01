import { Redirect } from "expo-router"
import { useAuth } from "../src/hooks/useAuth"

export default function Index() {
    const { firebaseUser, supabaseUser, isLoading } = useAuth()
    const authed = !!firebaseUser && !!supabaseUser

    if (isLoading) {
        return <Redirect href="/sign-in" />
    }

    if (authed) {
        return <Redirect href="/(private)" />
    }

    return <Redirect href="/sign-in" />
}