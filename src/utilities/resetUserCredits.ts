import { supabaseClient } from '../config/supabaseClient'

/**
 * DEVELOPMENT UTILITY: Reset user's free credits to 50
 * This is a temporary fix for users who have 0 credits in their free subscription
 */
export const resetUserCredits = async (userId: string): Promise<boolean> => {
    try {
        console.log('🔄 Resetting credits for user:', userId)

        const { data, error } = await supabaseClient
            .from('user_app_subscriptions')
            .update({
                current_credits: 50,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('app_name', 'clanker')
            .eq('plan_tier', 'free')
            .eq('plan_status', 'active')
            .select()

        if (error) {
            console.error('❌ Error resetting credits:', error)
            return false
        }

        console.log('✅ Credits reset to 50:', data)
        return true
    } catch (error) {
        console.error('❌ Exception resetting credits:', error)
        return false
    }
}
