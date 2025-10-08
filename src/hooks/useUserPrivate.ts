/**
 * Legacy hook for backward compatibility
 * @deprecated Use useUserPrivateData() from useUser.ts for new code
 *
 * This hook is maintained for backward compatibility but delegates to
 * the new React Query implementation for offline support.
 */

import { useUserPrivateData } from './useUser'
import type { UserPrivate } from '~/services/userService'

/**
 * Hook to get user private data from Supabase
 * Combines profile data with credits from user_app_subscriptions
 * Now uses React Query for caching and offline support
 */
export function useUserPrivate(): UserPrivate | null {
  const { userPrivate } = useUserPrivateData()
  return userPrivate || null
}
