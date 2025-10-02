import { useEffect, useState } from "react"
import { Redirect } from "expo-router"
import { useAuth } from "../src/hooks/useAuth"

export default function Index() {
    const { user, isLoading } = useAuth()
    const [shouldRedirect, setShouldRedirect] = useState(false)

    useEffect(() => {
        // Only redirect once we're done loading and have determined auth state
        if (!isLoading) {
            setShouldRedirect(true)
        }
    }, [isLoading])

    // Don't redirect while still loading auth state
    if (!shouldRedirect) {
        return null
    }

    if (user) {
        return <Redirect href="/(private)" />
    }

    return <Redirect href="/sign-in" />
}