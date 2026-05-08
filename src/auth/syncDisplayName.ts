import { updateProfile } from '@react-native-firebase/auth'
import { resolveDisplayNameToSync } from './syncDisplayNameShared'

/**
 * Syncs user displayName from auth provider credential.
 * Only updates when current displayName is missing or empty.
 *
 * Uses modular `updateProfile` from React Native Firebase (native User has no stable
 * web-compat `user.updateProfile` shape across versions).
 *
 * Fallback chain:
 * 1. Current user.displayName (if set, skip update)
 * 2. Explicit fallbackName parameter
 * 3. First provider's displayName from providerData
 * 4. Skip if no name available
 */
export const syncDisplayNameFromCredential = async (
  user: Parameters<typeof updateProfile>[0],
  fallbackName?: string,
): Promise<void> => {
  const next = resolveDisplayNameToSync(user, fallbackName)
  if (!next) return

  await updateProfile(user, { displayName: next })
}
