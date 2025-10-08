/**
 * Legacy hook for backward compatibility
 * @deprecated Use useUserPublicData() from useUser.ts for new code
 *
 * This hook is maintained for backward compatibility but delegates to
 * the new React Query implementation for offline support.
 */

import { useUserPublicData } from './useUser'
import type { UserPublic } from '~/services/userService'

/**
 * Hook to get user public data from Supabase
 * Now uses React Query for caching and offline support
 */
export function useUserPublic(): UserPublic | null {
  const { userPublic } = useUserPublicData()
  return userPublic || null
}
