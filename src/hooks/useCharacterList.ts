/**
 * Legacy hook for backward compatibility
 * @deprecated Use useCharacters() from useCharacters.ts for new code
 *
 * This hook is maintained for backward compatibility but delegates to
 * the new React Query implementation for offline support.
 */

import { useCharacterList as useCharacterListQuery } from './useCharacters'
import type { Character } from '~/services/characterService'

/**
 * Hook to get the current user's characters from Supabase
 * Now uses React Query for caching and offline support
 */
export function useCharacterList(): Character[] {
  return useCharacterListQuery()
}
