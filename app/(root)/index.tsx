import { Redirect } from "expo-router"

export default function TabsIndex() {
    // Direct redirect to characters to avoid any intermediate navigation states
    return <Redirect href="/characters" />
}