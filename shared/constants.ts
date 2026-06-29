import type { SequenceAction, SingleAction } from './dsl-types.js'

// Single source of truth for the two-layer destructive-action classifier.
// Imported by cloud-agent (Layer 1) and the extension content script (Layer 2).
export const DESTRUCTIVE_ACTION_PATTERN =
  /submit|delete|pay|confirm|send|checkout|transfer|remove|cancel subscription/i

export function classifyActionLabel(label: string | undefined | null): 'safe' | 'requires_auth' {
  if (!label) return 'safe'
  return DESTRUCTIVE_ACTION_PATTERN.test(label) ? 'requires_auth' : 'safe'
}

/** Layer 1 — Cloud Coordinator: actionSummary, step labels, and selectors. */
export function intentRequiresAuth(
  actionSummary: string,
  action: SingleAction | SequenceAction,
): boolean {
  if (DESTRUCTIVE_ACTION_PATTERN.test(actionSummary)) return true
  const steps: SingleAction[] = action.type === 'sequence' ? action.steps : [action]
  for (const step of steps) {
    const label = step.type === 'extract' || step.type === 'click' ? step.label : undefined
    if (classifyActionLabel(label) === 'requires_auth') return true
    if ('selector' in step && step.selector && DESTRUCTIVE_ACTION_PATTERN.test(step.selector)) return true
  }
  return false
}
