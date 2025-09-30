import { Redirect } from "expo-router"
import { useAuth } from "../src/hooks/useAuth"

export default function Index() {
    const { firebaseUser, supabaseUser } = useAuth()

    if (firebaseUser && supabaseUser) {
        return <Redirect href="/dashboard" />
    }

    return <Redirect href="/sign-in" />
}