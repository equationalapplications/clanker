import { Redirect } from "expo-router"

export default function PrivateIndex() {
    return <Redirect href="/dashboard" />
}
