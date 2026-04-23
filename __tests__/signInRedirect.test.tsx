/**
 * Tests for post-auth redirect utilities in src/utilities/authRedirect.ts.
 *
 * Covers:
 * - isProtectedPath: classifies public vs protected routes
 * - toValidatedInternalHref: rejects absolute URLs and protocol-relative paths
 * - resolveRedirectDestination: correct precedence (deep link > param > fallback)
 */

import type { Href } from 'expo-router'
import {
  isProtectedPath,
  toValidatedInternalHref,
  resolveRedirectDestination,
} from '../src/utilities/authRedirect'

describe('isProtectedPath', () => {
  it.each([
    ['/', false],
    ['/sign-in', false],
    ['/privacy', false],
    ['/terms', false],
    ['/support', false],
    ['/checkout', false],
    ['/checkout/success', false],
    ['/checkout/cancel', false],
    ['//evil.com', false],
    ['not-a-path', false],
  ])('marks %s as NOT protected', (path, expected) => {
    expect(isProtectedPath(path)).toBe(expected)
  })

  it.each([
    ['/chat', true],
    ['/chat/123', true],
    ['/characters', true],
    ['/characters/list', true],
    ['/characters/shared/abc', true],
    ['/profile', true],
    ['/settings', true],
    ['/subscribe', true],
    ['/admin', true],
    ['/admin/users', true],
    ['/accept-terms', true],
  ])('marks %s as protected', (path, expected) => {
    expect(isProtectedPath(path)).toBe(expected)
  })
})

describe('toValidatedInternalHref', () => {
  it('accepts valid internal paths', () => {
    expect(toValidatedInternalHref('/characters/list')).toBe('/characters/list')
    expect(toValidatedInternalHref('/chat')).toBe('/chat')
    expect(toValidatedInternalHref('/characters/shared/abc?foo=bar')).toBe(
      '/characters/shared/abc?foo=bar'
    )
  })

  it('rejects null and undefined', () => {
    expect(toValidatedInternalHref(null)).toBeNull()
    expect(toValidatedInternalHref(undefined)).toBeNull()
    expect(toValidatedInternalHref('')).toBeNull()
  })

  it('rejects absolute URLs', () => {
    expect(toValidatedInternalHref('https://evil.com/steal')).toBeNull()
    expect(toValidatedInternalHref('http://evil.com')).toBeNull()
  })

  it('rejects protocol-relative paths', () => {
    expect(toValidatedInternalHref('//evil.com')).toBeNull()
  })
})

describe('resolveRedirectDestination', () => {
  it('falls back to /characters/list when no deep link and no param', () => {
    expect(resolveRedirectDestination(null, undefined)).toBe('/characters/list')
  })

  it('uses redirect param when valid and no initial deep link', () => {
    expect(resolveRedirectDestination(null, '/characters/list')).toBe('/characters/list')
  })

  it('ignores unsafe absolute URL in redirect param and falls back', () => {
    expect(resolveRedirectDestination(null, 'https://evil.com/steal')).toBe('/characters/list')
  })

  it('ignores protocol-relative redirect param and falls back', () => {
    expect(resolveRedirectDestination(null, '//evil.com')).toBe('/characters/list')
  })

  it('prefers deep link over redirect param', () => {
    expect(
      resolveRedirectDestination('/characters/shared/abc' as Href, '/characters/list')
    ).toBe('/characters/shared/abc')
  })

  it('prefers deep link over fallback when no param', () => {
    expect(resolveRedirectDestination('/profile' as Href, undefined)).toBe('/profile')
  })
})

