import type { SequenceAction, SingleAction } from './dsl-types.js'

const BLOCKED_SCHEMES = new Set([
  'chrome:',
  'chrome-extension:',
  'file:',
  'javascript:',
  'data:',
  'about:',
  'edge:',
  'vivaldi:',
])

export function isBlockedUrl(url: string): { blocked: boolean; reason?: string } {
  const trimmed = url.trim()
  if (!trimmed) return { blocked: true, reason: 'Empty URL' }
  for (const scheme of BLOCKED_SCHEMES) {
    if (trimmed.toLowerCase().startsWith(scheme)) {
      return { blocked: true, reason: `Scheme not allowed: ${scheme}` }
    }
  }
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { blocked: true, reason: `Scheme not allowed: ${u.protocol}` }
    }
    return { blocked: false }
  } catch {
    return { blocked: true, reason: 'Invalid URL' }
  }
}

export function findBlockedNavigation(action: SingleAction | SequenceAction): { message: string } | null {
  if (action.type === 'sequence') {
    for (const step of action.steps) {
      const hit = findBlockedNavigation(step)
      if (hit) return hit
    }
    return null
  }
  if (action.type === 'open_tab') {
    const { blocked, reason } = isBlockedUrl(action.url)
    if (blocked) return { message: reason ?? 'HOST_NOT_ALLOWED' }
  }
  if (action.type === 'focus_tab') {
    if (!action.host.trim()) return { message: 'Invalid host' }
  }
  return null
}
