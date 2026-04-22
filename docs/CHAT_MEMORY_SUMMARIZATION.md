# Chat Memory Summarization

This document describes how chat memory is compacted in the Expo app to reduce SQLite growth and prompt bloat.

## Summary

The app now summarizes each conversation automatically every 20 stored messages.

The generated summary is written into the character `context` field and old chat rows are pruned, while the most recent 20 messages are kept in SQLite for near-term conversational detail.

## Trigger Behavior

- Trigger condition: total message count for a character conversation reaches a multiple of 20.
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

