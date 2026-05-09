import { updateProfile, type User } from 'firebase/auth'
import { resolveDisplayNameToSync } from './syncDisplayNameShared'

/**
 * Syncs user displayName from auth provider credential (web modular SDK).
 * Uses top-level `updateProfile` — the web `User` type does not expose `user.updateProfile`.
 *
 * Fallback chain matches native: see syncDisplayName.ts.
 */
export const syncDisplayNameFromCredential = async (
  user: User,
  fallbackName?: string,
): Promise<void> => {
  const next = resolveDisplayNameToSync(user, fallbackName)
  if (!next) return

  await updateProfile(user, { displayName: next })
}
