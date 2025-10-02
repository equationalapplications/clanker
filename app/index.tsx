import { Redirect } from "expo-router"

export default function Index() {
    // Direct redirect to characters - Stack.Protected will handle auth routing
    return <Redirect href="/characters" />
}