// Legacy hook that now uses Supabase
import { useSupabaseUserPrivate } from "./useSupabaseUserProfile"

interface UserPrivate {
  credits: number
  isProfilePublic: boolean | null
  defaultCharacter: string
  hasAcceptedTermsDate: Date | null
}

export function useUserPrivate(): UserPrivate | null {
  // Use Supabase version
  return useSupabaseUserPrivate()
}
