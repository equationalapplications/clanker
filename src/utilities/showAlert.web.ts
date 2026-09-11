import type { AlertAction } from './showAlert'

export type { AlertAction }

/**
 * Web half of the alert seam — see showAlert.ts for why this exists.
 *
 * Maps the native two-button shape onto `window.confirm`: the first
 * non-cancel action is the confirm branch. Anything without such an action
 * degrades to `window.alert`. `confirm`/`alert` are synchronous and block the
 * event loop, which matches the native callback contract closely enough for the
 * confirm-or-cancel prompts this is used for.
 */
export function showAlert(title: string, message: string, actions?: AlertAction[]): void {
  const body = message ? `${title}\n\n${message}` : title

  const confirmAction = actions?.find((action) => action.style !== 'cancel' && action.onPress)

  if (typeof window === 'undefined') return

  if (!confirmAction) {
    window.alert(body)
    // A cancel-only action list (or a confirm-less one) reaches this branch.
    // The native `Alert.alert` path invokes the cancel callback when the user
    // dismisses the dialog; the web twin must mirror that, otherwise the
    // cancel action's `onPress` never fires and callers that close over it
    // (e.g. an "acknowledge" flag) appear to no-op on web.
    actions?.find((action) => action.style === 'cancel')?.onPress?.()
    return
  }

  if (window.confirm(`${body}\n\n${confirmAction.text}?`)) {
    confirmAction.onPress?.()
    return
  }

  actions?.find((action) => action.style === 'cancel')?.onPress?.()
}
