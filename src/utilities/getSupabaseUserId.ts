import { getSupabaseSession } from '~/utilities/getSupabaseSession'

export async function getSupabaseUserId(): Promise<string | null> {
  const session = await getSupabaseSession()
  if (!session?.user) return null
  return session.user.id
}
