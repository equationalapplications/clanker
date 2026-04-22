# Chat Memory Summarization

This document describes how chat memory is compacted in the Expo app to reduce SQLite growth and prompt bloat.

## Summary

The app summarizes a conversation when at least 20 newly accumulated stored messages have been added since the last successful summary checkpoint.

The generated summary is written into the character `context` field and old chat rows are pruned, while the most recent 20 messages are kept in SQLite for near-term conversational detail.

## Trigger Behavior

- `characters.summary_checkpoint` stores the stored-message count baseline recorded after the last successful summarization for a `(characterId, userId)` conversation.
- `messageCount` is the current `COUNT(*)` of stored messages for that conversation.
- Trigger condition: run summarization when `messageCount - summary_checkpoint >= 20`.
- Because older rows are pruned after summarization, `messageCount` can decrease over time; this is not a simple "total historical messages reached a multiple of 20" rule.
- Trigger location: after an AI reply is saved locally.
- Execution mode: fire-and-forget background task so message send UX is not blocked.
- Concurrency guard: one summary job per `(characterId, userId)` can run at a time.

## Summary Input Strategy

Each new summary is generated from:

1. The previous stored summary in `characters.context` (older memory), and
2. The most recent 20 conversation messages (higher priority).

Prompt instructions explicitly prioritize recent messages over older summarized context when conflicts appear.

## Summary Output Rules

- Max summary length: 4000 characters.
- Destination: `characters.context`.
- Empty summaries are rejected.

## SQLite Retention

After a successful summary update:

- Keep latest 20 messages for the conversation.
- Delete older conversation messages for that `(characterId, userId)` pair.

This reduces local storage growth and limits prompt history size while preserving long-term memory in summarized form.

## Cloud Function: `summarizeText`

A new Firebase callable function (`summarizeText`) performs summarization on Vertex AI.

### Contract

Input:

```json
{
  "text": "string (required, non-empty, max 16000 chars)",
  "maxCharacters": "number (required positive integer, no server-side upper bound)"
}
```

Response:

```json
{
  "summary": "string"
}
```

### Security and Cost

- Firebase Auth required
- App Check enforced
- No user credits are spent by this function
- Uses a cost-efficient text model (`gemini-2.5-flash`) for summarization

