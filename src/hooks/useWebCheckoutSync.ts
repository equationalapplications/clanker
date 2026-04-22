import type { UseWebCheckoutSyncOptions, WebCheckoutSyncResult } from './useWebCheckoutSync.web'

export type { UseWebCheckoutSyncOptions, WebCheckoutLocks, WebCheckoutSyncResult } from './useWebCheckoutSync.web'

export function useWebCheckoutSync(_options: UseWebCheckoutSyncOptions = {}): WebCheckoutSyncResult {
  return {
    locks: {
      isPaygLocked: false,
      isSubscribeLocked: false,
    },
    expiredMessage: null,
    clearExpiredMessage: () => {},
  }
}
