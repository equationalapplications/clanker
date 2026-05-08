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
  let providerName = ''
  for (const p of user.providerData ?? []) {
    const trimmed = p.displayName?.trim()
    if (trimmed) {
      providerName = trimmed
      break
    }
  }
  const next = fallback || providerName
  if (!next) return null
  return next
}
