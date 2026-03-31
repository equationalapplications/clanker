import { useState, useEffect } from 'react'
import { supabaseClient } from '~/config/supabaseClient'
import { APP_NAME, SUBSCRIPTION_TIERS, type PlanTier } from '~/config/constants'

interface CurrentPlan {
    tier: PlanTier | null
    isSubscriber: boolean
    isLoading: boolean
}

interface JwtPlan {
    app: string
    tier: PlanTier
}

function decodeJwtPayload(token: string): Record<string, unknown> {
    const base64 = token.split('.')[1]
    // atob is available in both web and React Native (Expo polyfills it)
    const json = atob(base64)
    return JSON.parse(json)
}

function extractTierFromToken(accessToken: string, appName: string): PlanTier | null {
    try {
        const payload = decodeJwtPayload(accessToken)
        const plans = payload.plans as JwtPlan[] | undefined
        if (!Array.isArray(plans)) return null
        const match = plans.find((p) => p.app === appName)
        return match?.tier ?? null
    } catch {
        return null
    }
}

export function useCurrentPlan(): CurrentPlan {
    const [tier, setTier] = useState<PlanTier | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        let mounted = true

        async function readPlan() {
            const { data: { session } } = await supabaseClient.auth.getSession()
            if (!mounted) return

            if (session?.access_token) {
                setTier(extractTierFromToken(session.access_token, APP_NAME))
            } else {
                setTier(null)
            }
            setIsLoading(false)
        }

        readPlan()

        const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
            (_event, session) => {
                if (!mounted) return
                if (session?.access_token) {
                    setTier(extractTierFromToken(session.access_token, APP_NAME))
                } else {
                    setTier(null)
                }
                setIsLoading(false)
            },
        )

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])

    const isSubscriber = tier !== null && SUBSCRIPTION_TIERS.includes(tier)

    return { tier, isSubscriber, isLoading }
}
