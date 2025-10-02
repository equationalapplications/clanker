import { Redirect } from "expo-router"

export default function Index() {
    // This will redirect to the first available screen based on auth state
    // If logged in: goes to (tabs) -> characters
    // If not logged in: goes to sign-in (due to Stack.Protected guard)
    return <Redirect href="/characters" />
}