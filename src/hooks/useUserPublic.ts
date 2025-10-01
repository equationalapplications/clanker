// Legacy hook that now uses Supabase
import { useSupabaseUserPublic } from "./useSupabaseUserProfile"

interface UserPublic {
  uid: string
  name: string
  avatar: string
  email: string
}

export function useUserPublic(): UserPublic | null {
  // Use Supabase version
  return useSupabaseUserPublic()
}
