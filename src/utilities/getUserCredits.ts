import { supabaseClient } from "../config/supabaseClient"
import { auth } from "../config/firebaseConfig"

interface UserCredits {
    totalCredits: number
    hasUnlimited: boolean
    subscriptions: Array<{
        tier: string
        credits: number
        isUnlimited: boolean
    }>
}

export const getUserCredits = async (): Promise<UserCredits> => {
    if (!auth.currentUser) {
        return {
            totalCredits: 0,
            hasUnlimited: false,
            subscriptions: []
        }
    }

    const uid = auth.currentUser.uid

    try {
        // Query all active subscriptions and credit records for the user
        const { data: subscriptions, error } = await supabaseClient
            .from('user_app_subscriptions')
            .select('plan_tier, credits_remaining, plan_status')
            .eq('user_id', uid)
            .eq('app_name', 'yours-brightly')
            .eq('plan_status', 'active')

        if (error) {
            console.error('Error fetching user credits:', error)
            return {
                totalCredits: 0,
                hasUnlimited: false,
                subscriptions: []
            }
        }

        let totalCredits = 0
        let hasUnlimited = false
        const subscriptionDetails: Array<{
            tier: string
            credits: number
            isUnlimited: boolean
        }> = []

        for (const sub of subscriptions || []) {
            const credits = sub.credits_remaining || 0
            const isUnlimited = sub.plan_tier === 'monthly_unlimited'

            subscriptionDetails.push({
                tier: sub.plan_tier,
                credits,
                isUnlimited
            })

            if (isUnlimited) {
                hasUnlimited = true
            } else {
                totalCredits += credits
            }
        }

        // If user has no subscriptions, they get 50 free credits on first login
        if (subscriptions.length === 0) {
            // Check if we need to create initial free credits
            await ensureInitialFreeCredits(uid)
            return {
                totalCredits: 50,
                hasUnlimited: false,
                subscriptions: [{
                    tier: 'free',
                    credits: 50,
                    isUnlimited: false
                }]
            }
        }

        return {
            totalCredits,
            hasUnlimited,
            subscriptions: subscriptionDetails
        }
    } catch (error) {
        console.error('Error checking user credits:', error)
        return {
            totalCredits: 0,
            hasUnlimited: false,
            subscriptions: []
        }
    }
}

async function ensureInitialFreeCredits(uid: string): Promise<void> {
    try {
        // Create initial free credits record for new users
        const { error } = await supabaseClient
            .from('user_app_subscriptions')
            .insert({
                user_id: uid,
                app_name: 'yours-brightly',
                plan_tier: 'free',
                plan_status: 'active',
                credits_remaining: 50,
                billing_provider_id: 'initial_free_credits',
                billing_metadata: {
                    type: 'initial_free_credits',
                    created_at: new Date().toISOString()
                }
            })

        if (error) {
            console.error('Error creating initial free credits:', error)
        } else {
            console.log('Created initial 50 free credits for user:', uid)
        }
    } catch (error) {
        console.error('Error ensuring initial free credits:', error)
    }
}

/**
 * Deduct credits from user's account
 * @param amount - Number of credits to deduct
 * @returns Promise<boolean> - Success status
 */
export const deductCredits = async (amount: number): Promise<boolean> => {
    if (!auth.currentUser) {
        return false
    }

    const uid = auth.currentUser.uid

    try {
        // First check if user has unlimited plan
        const { data: unlimitedSubs } = await supabaseClient
            .from('user_app_subscriptions')
            .select('plan_tier')
            .eq('user_id', uid)
            .eq('app_name', 'yours-brightly')
            .eq('plan_status', 'active')
            .eq('plan_tier', 'monthly_unlimited')
            .limit(1)

        if (unlimitedSubs && unlimitedSubs.length > 0) {
            // User has unlimited plan, no need to deduct credits
            console.log('User has unlimited plan, no credits deducted')
            return true
        }

        // Get all active subscriptions with credits
        const { data: subscriptions } = await supabaseClient
            .from('user_app_subscriptions')
            .select('id, plan_tier, credits_remaining')
            .eq('user_id', uid)
            .eq('app_name', 'yours-brightly')
            .eq('plan_status', 'active')
            .gt('credits_remaining', 0)
            .order('plan_tier', { ascending: true }) // Prioritize certain tiers if needed

        if (!subscriptions || subscriptions.length === 0) {
            console.log('No credits available for deduction')
            return false
        }

        let remainingToDeduct = amount

        for (const sub of subscriptions) {
            if (remainingToDeduct <= 0) break

            const availableCredits = sub.credits_remaining || 0
            const toDeduct = Math.min(remainingToDeduct, availableCredits)
            const newCredits = availableCredits - toDeduct

            // Update the subscription with new credit amount
            const { error } = await supabaseClient
                .from('user_app_subscriptions')
                .update({
                    credits_remaining: newCredits,
                    updated_at: new Date().toISOString()
                })
                .eq('id', sub.id)

            if (error) {
                console.error('Error updating credits:', error)
                return false
            }

            remainingToDeduct -= toDeduct
            console.log(`Deducted ${toDeduct} credits from ${sub.plan_tier}, remaining: ${newCredits}`)
        }

        return remainingToDeduct === 0
    } catch (error) {
        console.error('Error deducting credits:', error)
        return false
    }
}