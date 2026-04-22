# Multi-Tab Checkout Robustness & Stripe Return-Tab Recovery

## Overview

This document describes how Clanker's checkout flow maintains robustness across multiple browser tabs and recovers safely when users return from a Stripe redirect in a different tab. The system uses a combination of `localStorage`, `BroadcastChannel`, focus/visibility tracking, and per-product locks to ensure that purchase state remains consistent without polling.

## Architecture

### Same-Tab Stripe Redirect

When a user initiates a purchase:

1. **attemptId contract**: A unique `attemptId` is generated and persisted to `localStorage` before redirecting to Stripe
2. **Stripe success/cancel redirect**: Stripe redirects back to the configured return URL (e.g., `/checkout/return?session_id=...`)
3. **Return-page behavior**: The return page retrieves the `attemptId` from `localStorage`, validates it against the session, and initiates recovery logic

### Multi-Tab Awareness with BroadcastChannel

When Stripe redirects in one tab:

- The return-page tab broadcasts a message via `BroadcastChannel` to all other open tabs
- Other tabs listen for the broadcast and clean up their checkout state to avoid stale UI
- This prevents scenarios where Tab A completes a purchase while Tab B still shows a pending checkout button

### localStorage + BroadcastChannel Architecture

**localStorage** stores:
- `attemptId`: The unique attempt identifier for the current purchase flow
- `lastValidatedAttemptId`: The most recent successfully processed attemptId (for TTL stale recovery)
- Product-specific lock entries for per-product purchase coordination

**BroadcastChannel** broadcasts:
- Checkout completion events (success/cancel) across tabs
- Product lock acquisitions and releases
- UID changes (triggering cache invalidation)

## State Management & Locking

### Per-Product Locks

To prevent race conditions where multiple tabs attempt simultaneous purchases of the same product:

- Before starting checkout, the system acquires a per-product lock stored in `localStorage`
- The lock is scoped to the product ID and current user UID
- Other tabs monitor this lock via `BroadcastChannel` and disable their purchase buttons for that product
- The lock is released on successful completion or cancellation

### TTL Stale Recovery

When returning from Stripe:

1. The `attemptId` from the URL/localStorage is validated
2. `lastValidatedAttemptId` is checked to ensure the attempt is not stale (within TTL window)
3. If stale, the system discards the attempt and clears associated state
4. If valid, the system proceeds with recovery and credit reconciliation

## State Clearing & Synchronization

### Sign-Out & UID Changes

When a user signs out or their UID changes:

- All checkout-related `localStorage` entries are cleared via a `BroadcastChannel` message
- All `attemptId` and lock entries are discarded
- This prevents scenarios where a user signs out, someone else signs in, and old purchase attempts leak into the new session

### No Polling

The system does **not** use interval polling to check purchase state. Instead:

- **Focus/visibility recovery**: When a tab regains focus or becomes visible, it queries the server once to reconcile state
- **BroadcastChannel events**: Explicit broadcasts trigger immediate reconciliation across tabs
- **Convergence via requestBootstrapRefresh**: The auth bootstrap refresh mechanism is event-driven and deduped; when checkout completes, a purchase-scoped refresh is requested but not forced repeatedly

## Stripe Return-Tab Recovery Flow

1. **User completes Stripe payment**: Redirects to return URL in a possibly different tab
2. **Return page loads**: Retrieves `attemptId` from localStorage
3. **Validation query**: Calls the server to validate the `attemptId` and session state
4. **BroadcastChannel broadcast**: Notifies all tabs of the result (success/cancel/expired)
5. **Tab cleanup**: Listening tabs clear their checkoutStateStore and per-product locks
6. **Credits reconciliation**: If successful, the returning tab displays confirmation and triggers `requestBootstrapRefresh('purchase')`
7. **Convergence**: The purchase-driven bootstrap refresh is event-driven and deduped; multiple tabs do not re-query unnecessarily

## Testing & Verification

### Manual Testing Checklist

- **Single-tab flow**: Initiate purchase, complete Stripe redirect in same tab, verify state cleanup
- **Multi-tab flow**: Open checkout in Tab A, initiate Stripe in Tab A, complete redirect in Tab B, verify Tab A's checkout UI is disabled
- **Tab closure**: Close the return-tab after Stripe redirect, verify other tabs eventually recover state via focus event
- **Stale recovery**: Wait longer than TTL window, attempt to use old `attemptId`, verify it is rejected
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
- **Server-side state**: The source of truth (payment success/failure) lives on the server, queried once on return
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
- **TTL enforcement**: Stale attempts are rejected even if `attemptId` is present in storage
- **Sign-out clears state**: All checkout data is removed when authentication changes

## Related Documentation

- [Payment System Design](PAYMENT_SYSTEM.md) — Overall billing architecture
- [Bootstrap Event-Driven Refresh](BOOTSTRAP_EVENT_DRIVEN_REFRESH.md) — How auth bootstrap reconciliation works
- [Chat Response Function](CHAT_RESPONSE_FUNCTION.md) — Example of event-driven server-side operations
