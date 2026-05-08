type MinimalUser = {
  displayName: string | null
  providerData: { displayName?: string | null }[]
}

/**
 * Resolves the display name to persist, or null if no update should run.
 */
export const resolveDisplayNameToSync = (
  user: MinimalUser,
  fallbackName?: string,
): string | null => {
  const current = user.displayName?.trim()
  if (current) return null

  const fallback = fallbackName?.trim()
  const providerName = user.providerData?.[0]?.displayName?.trim() || ''
  const next = fallback || providerName
  if (!next) return null
  return next
}
