/**
 * Legacy hook for backward compatibility
 * @deprecated Use useCharacter() from useCharacters.ts for new code
 *
 * This hook is maintained for backward compatibility but delegates to
 * the new React Query implementation for offline support.
 */

import { useCharacter as useCharacterQuery } from './useCharacters'
import type { LegacyCharacter } from '~/services/characterService'

interface UseCharacterArgs {
  id: string
  userId?: string
}

/**
 * Hook to get a specific character from Supabase
 * Now uses React Query for caching and offline support
 */
export function useCharacter({ id, userId }: UseCharacterArgs): LegacyCharacter | null {
  const { character } = useCharacterQuery(id)
  return character
}
