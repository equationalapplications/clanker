import { Redirect } from "expo-router"

export default function TabsIndex() {
    console.log('📱 (root)/index rendering - redirecting to characters')
    // Direct redirect to characters tab within the root tab group
    return <Redirect href="/characters" />
}