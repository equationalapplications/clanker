// Single source of truth for the two-layer destructive-action classifier.
// Imported by cloud-agent (Layer 1) and the extension content script (Layer 2).
export const DESTRUCTIVE_ACTION_PATTERN =
  /submit|delete|pay|confirm|send|checkout|transfer|remove|cancel subscription/i

export function classifyActionLabel(label: string | undefined | null): 'safe' | 'requires_auth' {
  if (!label) return 'safe'
  return DESTRUCTIVE_ACTION_PATTERN.test(label) ? 'requires_auth' : 'safe'
}
