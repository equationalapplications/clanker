import { useEffect, useState } from 'react'
import { UserProfile, UserPublic, subscribeToUserProfile } from '../services/userService'

/**
 * Hook to get user public data from Supabase
 */
export function useUserPublic(): UserPublic | null {
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeToUserProfile((newProfile) => {
      setProfile(newProfile)
    })

    return unsubscribe
  }, [])

  if (!profile) {
    return null
  }

  return {
    uid: profile.user_id,
    name: profile.display_name || profile.email || '',
    avatar: profile.avatar_url || '',
    email: profile.email || '',
  }
}
