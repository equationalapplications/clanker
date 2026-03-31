import { supabaseClient } from '~/config/supabaseClient'

export async function getSupabaseUserId(): Promise<string | null> {
    const { data: { user }, error } = await supabaseClient.auth.getUser()
    if (error || !user) return null
    return user.id
}
