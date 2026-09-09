// Mirrored from functions/src/services/proactiveWakeupGuardrails.ts.
// Both sides assert the literal in a test so drift fails a suite rather than
// silently disagreeing about which messages are badged.
export const UNREAD_STALENESS_ESCAPE_MS = 604_800_000

export const PROACTIVE_SYNC_CURSOR_KEY = 'proactive_messages'

// Task 11 stores the pending mark-read ids (a JSON-encoded string array)
// under this key in the `sync_state` table. Reuses the existing table so the
// queue survives an app kill — an in-memory array would lose anything enqueued
// before the call succeeded.
export const PROACTIVE_READ_QUEUE_KEY = 'mark_read_pending'
