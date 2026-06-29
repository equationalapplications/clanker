import { DESTRUCTIVE_ACTION_PATTERN } from '../shared/constants.js'

export function classifyElement(el: Element): 'safe' | 'requires_auth' {
  const text = (el.textContent ?? '').toLowerCase()
  if (DESTRUCTIVE_ACTION_PATTERN.test(text)) return 'requires_auth'
  if (el.closest('form') && el.matches('[type=submit]')) return 'requires_auth'
  const valueAttr = ((el as HTMLInputElement).value ?? el.getAttribute('value') ?? '').toLowerCase()
  if (DESTRUCTIVE_ACTION_PATTERN.test(valueAttr)) return 'requires_auth'
  const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase()
  if (DESTRUCTIVE_ACTION_PATTERN.test(ariaLabel)) return 'requires_auth'
  return 'safe'
}
