# Multi-Tab Checkout Robustness & Stripe Return-Tab Recovery

## Overview

This document describes how Clanker's checkout flow maintains robustness across multiple browser tabs and recovers safely when users return from a Stripe redirect in a different tab. The system uses a combination of `localStorage`, `BroadcastChannel`, focus/visibility tracking, and per-product locks to ensure that purchase state remains consistent without polling.

## Architecture

### Same-Tab Stripe Redirect

When a user initiates a purchase:

1. **attemptId contract**: A unique `attemptId` is generated and persisted to `localStorage` before redirecting to Stripe
2. **Stripe success/cancel redirect**: Stripe redirects back to `/checkout/success?attemptId=...` or `/checkout/cancel?attemptId=...`
3. **Return-page behavior**: The success/cancel route reads the `attemptId` from query params, updates the matching per-UID attempt record, and broadcasts the terminal event for cross-tab unlock/recovery

### Multi-Tab Awareness with BroadcastChannel

When Stripe redirects in one tab:

- The return-page tab broadcasts a message via `BroadcastChannel` to all other open tabs
- Other tabs listen for the broadcast and clean up their checkout state to avoid stale UI
- This prevents scenarios where Tab A completes a purchase while Tab B still shows a pending checkout button

### localStorage + BroadcastChannel Architecture

**localStorage** stores:
- `checkout:attempts:${uid}`: JSON object keyed by `attemptId`, where each value is a `CheckoutAttemptRecord` (`attemptId`, `productType`, `status`, `at`, `sourceTabId`, `schemaVersion`)
- Pending records in that map are the source of truth for derived pay-as-you-go vs subscription lock state
- Terminal (`succeeded` / `cancelled` / `expired`) records remain in the map until explicitly cleared

**BroadcastChannel** broadcasts:
- Checkout lifecycle events (`CHECKOUT_STARTED`, `CHECKOUT_SUCCEEDED`, `CHECKOUT_CANCELLED`, `CHECKOUT_STALE_CLEARED`) across tabs
- Derived lock-state transitions (pending -> terminal/expired) for pay-as-you-go and subscription purchase UI
- UID changes (triggering cache invalidation)

## State Management & Locking

### Per-Product Locks

To prevent race conditions where multiple tabs attempt simultaneous purchases of the same product:

- Before starting checkout, the system writes a `pending` attempt record for the current UID and product type
- Locks are derived from `pending` attempt records (`payg` vs non-`payg`) rather than separate lock keys
- Other tabs consume checkout channel events and re-derive lock state from shared attempt records
- Locks clear when matching attempts move to `succeeded`, `cancelled`, or `expired`

### TTL Stale Recovery

When returning from Stripe:

1. The active attempt map is loaded from `checkout:attempts:${uid}`
2. Pending records are compared against the TTL window
3. If stale, the record transitions to `expired` and a `CHECKOUT_STALE_CLEARED` event is broadcast
4. Remaining non-stale records continue driving lock state until they transition terminally

## State Clearing & Synchronization

### Sign-Out & UID Changes

When a user signs out or their UID changes:

- A `BroadcastChannel` message triggers cleanup of pending checkout attempt state and invalidates active checkout-related UI state across tabs
- Pending `attemptId` state is cleared, and lock entries are discarded so another user does not inherit an in-progress checkout flow
- This prevents scenarios where a user signs out, someone else signs in, and stale in-progress purchase state leaks into the new session

### No Polling

The system does **not** use interval polling to check purchase state. Instead:

- **Focus/visibility recovery**: When a tab regains focus or becomes visible, it re-hydrates checkout attempt state from `localStorage`, re-derives lock state locally, and expires stale pending attempts based on TTL
- **BroadcastChannel events**: Explicit broadcasts trigger immediate reconciliation across tabs
- **Convergence via requestBootstrapRefresh**: The auth bootstrap refresh mechanism is event-driven and deduped; when a checkout reaches a terminal state, a purchase-scoped refresh may be requested to converge server-backed state without repeated queries

## Stripe Return-Tab Recovery Flow

1. **User completes Stripe payment**: Redirects to success/cancel URL in a possibly different tab
2. **Return page loads**: Reads `attemptId` from the URL query string
3. **Local attempt transition**: If a matching record exists under `checkout:attempts:${uid}`, it is updated to `succeeded` or `cancelled`
4. **BroadcastChannel broadcast**: The return tab publishes a terminal event so other tabs immediately re-derive lock state
5. **Tab cleanup**: Listening tabs unlock affected product flows; stale pending records are later transitioned to `expired` by TTL recovery when tabs regain focus/visibility
6. **Credits reconciliation**: On success, the return tab triggers `requestBootstrapRefresh('purchase')`
7. **Convergence**: The purchase-driven bootstrap refresh is event-driven and deduped; multiple tabs do not re-query unnecessarily

## Testing & Verification

### Manual Testing Checklist

- **Single-tab flow**: Initiate purchase, complete Stripe redirect in same tab, verify state cleanup
- **Multi-tab flow**: Open checkout in Tab A, initiate Stripe in Tab A, complete redirect in Tab B, verify Tab A receives the terminal update, clears pending state, and its checkout UI unlocks
- **Tab closure**: Close the return-tab after Stripe redirect, verify other tabs eventually recover state via focus event
- **Stale recovery**: Wait longer than TTL window, regain focus/visibility, verify the stale pending attempt is transitioned locally to `expired` and the UI shows timeout/recovery messaging rather than remaining locked
- **Sign-out**: Complete a purchase, sign out, sign back in as different user, verify old `attemptId` is inaccessible
- **UID change**: Trigger UID change (token refresh with new UID), verify all locks are cleared

### Automated Test Coverage

- Test `attemptId` generation and validation
- Test `BroadcastChannel` message delivery and cleanup
- Test per-product lock acquisition and release
- Test TTL stale detection
- Test focus/visibility recovery flow
- Test state clearing on sign-out

## Implementation Notes

### No Re-Polling

The system relies on:
- **Event-driven updates**: BroadcastChannel broadcasts and visibility changes trigger reconciliation
- **Server-side state**: Stripe/webhook processing remains the backend source of truth; return pages only apply local terminal transitions from the redirect context
- **Deduplication**: Multiple concurrent recovery attempts are deduped by the bootstrap refresh mechanism

### requestBootstrapRefresh('purchase') Convergence

When a purchase completes:

- The `requestBootstrapRefresh('purchase')` function is called to refresh user credits
- This refresh is **event-driven** (triggered by the completion event, not polling)
- The refresh is **deduped** by the bootstrap state machine; multiple calls within a TTL window do not trigger multiple server queries
- This ensures that credits are eventually consistent without expensive polling

### Cross-Tab Coordination

BroadcastChannel ensures that:
- Only one tab processes the Stripe return
- Other tabs are notified and clean up immediately
- No race conditions occur during lock acquisition
- UID changes are propagated to all tabs for cache invalidation

## Security Considerations

- **attemptId is scoped to UID**: An `attemptId` is only valid for the user who initiated it
- **Locks are per-product + UID**: Prevents cross-user purchase race conditions
- **localStorage is per-origin**: Web checkout only; native app uses in-memory state
- **TTL handling**: Stale pending attempts are expired during focus/visibility recovery, even if their `attemptId` is still present in storage
- **Sign-out clears pending state**: Pending attempts are removed on auth identity changes so new sessions do not inherit in-progress locks

## Related Documentation

- [Payment System Design](PAYMENT_SYSTEM.md) — Overall billing architecture
- [Bootstrap Event-Driven Refresh](BOOTSTRAP_EVENT_DRIVEN_REFRESH.md) — How auth bootstrap reconciliation works
- [Chat Response Function](CHAT_RESPONSE_FUNCTION.md) — Example of event-driven server-side operations
