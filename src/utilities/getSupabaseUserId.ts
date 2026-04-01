import { supabaseClient } from '~/config/supabaseClient'

export async function getSupabaseUserId(): Promise<string | null> {
    const { data: { session }, error } = await supabaseClient.auth.getSession()
    if (error || !session?.user) return null
    return session.user.id
}
