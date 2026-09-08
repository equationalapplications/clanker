// Mirrored from functions/src/services/proactiveWakeupGuardrails.ts.
// Both sides assert the literal in a test so drift fails a suite rather than
// silently disagreeing about which messages are badged.
export const UNREAD_STALENESS_ESCAPE_MS = 604_800_000

export const PROACTIVE_SYNC_CURSOR_KEY = 'proactive_messages'
