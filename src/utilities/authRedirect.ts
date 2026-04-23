import type { Href } from 'expo-router'

// Public paths that should NOT trigger post-auth redirect restore.
// Everything else is assumed to be behind auth and eligible for deep-link restore.
// Also covers always-accessible routes: support, checkout/*, etc.
export const PUBLIC_PATHS = new Set(['/', '/sign-in', '/privacy', '/terms', '/support'])

export function isProtectedPath(pathname: string): boolean {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) {
    return false
  }

  // Allow /checkout/* through as public (checkout flow is always accessible)
  if (pathname === '/checkout' || pathname.startsWith('/checkout/')) {
    return false
  }

  return !PUBLIC_PATHS.has(pathname)
}

export function toValidatedInternalHref(pathname: string | null | undefined): Href | null {
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) {
    return null
  }

  return pathname as Href
}

/**
 * Resolves the post-auth redirect destination.
 * Preference order:
 * 1. cold-start deep link recovered from Linking.getInitialURL()
 * 2. in-app redirect param supplied by caller
 * 3. standard post-auth fallback
 */
export function resolveRedirectDestination(
  initialRedirect: Href | null,
  redirectParam: string | undefined,
): Href {
  const initialRedirectPathname =
    typeof initialRedirect === 'string' ? initialRedirect.split(/[?#]/, 1)[0] : null
  const validatedInitialRedirect =
    initialRedirect &&
    initialRedirectPathname &&
    toValidatedInternalHref(initialRedirectPathname) &&
    isProtectedPath(initialRedirectPathname)
      ? initialRedirect
      : null

  const paramRedirect = toValidatedInternalHref(
    typeof redirectParam === 'string' ? redirectParam : undefined
  )
  const paramRedirectPathname =
    typeof paramRedirect === 'string' ? paramRedirect.split(/[?#]/, 1)[0] : null
  const protectedParamRedirect =
    paramRedirect && paramRedirectPathname && isProtectedPath(paramRedirectPathname)
      ? paramRedirect
      : null

  return validatedInitialRedirect ?? protectedParamRedirect ?? '/characters/list'
}
