import type { CheckoutAttemptRecord } from './checkoutStateStore'

export type CheckoutEventType =
  | 'CHECKOUT_STARTED'
  | 'CHECKOUT_SUCCEEDED'
  | 'CHECKOUT_CANCELLED'
  | 'CHECKOUT_STALE_CLEARED'

export interface CheckoutChannelEvent {
  type: CheckoutEventType
  payload: CheckoutAttemptRecord
}

export type CheckoutChannelHandler = (event: CheckoutChannelEvent) => void

export interface CheckoutChannel {
  publish: (event: CheckoutChannelEvent) => void
  subscribe: (handler: CheckoutChannelHandler) => () => void
  close: () => void
}

export interface CreateCheckoutChannelOptions {
  uid: string
}

export function createCheckoutChannel(_options: CreateCheckoutChannelOptions): CheckoutChannel {
  return {
    publish: (_event: CheckoutChannelEvent) => {
      // No-op on native.
    },
    subscribe: (_handler: CheckoutChannelHandler) => {
      return () => {
        // No-op on native.
      }
    },
    close: () => {
      // No-op on native.
    },
  }
}
