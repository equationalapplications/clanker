type UserLike = {
  displayName: string | null
  providerData: Array<{ displayName?: string | null }>
  updateProfile: (profile: { displayName?: string | null; photoURL?: string | null }) => Promise<void>
}

/**
 * Syncs user displayName from auth provider credential.
 * Only updates when current displayName is missing or empty.
 *
 * Fallback chain:
 * 1. Current user.displayName (if set, skip update)
 * 2. Explicit fallbackName parameter
 * 3. First provider's displayName from providerData
 * 4. Skip if no name available
 *
 * @param user - Firebase-like user object with displayName and updateProfile
 * @param fallbackName - Optional explicit name (e.g., from provider's name fields)
 * @returns Promise that resolves when profile update completes or is skipped
 */
export const syncDisplayNameFromCredential = async (
  user: UserLike,
  fallbackName?: string,
): Promise<void> => {
  const current = user.displayName?.trim()
  if (current) return

  const fallback = fallbackName?.trim()
  const providerName = user.providerData?.[0]?.displayName?.trim() || ''
  const next = fallback || providerName
  if (!next) return

  await user.updateProfile({ displayName: next })
}
