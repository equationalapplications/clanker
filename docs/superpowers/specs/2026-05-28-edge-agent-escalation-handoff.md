# Edge Agent Escalation Handoff — Followup Spec

> **⚠️ DEPRECATED — historical record only.** Escalation and sync concepts here remain relevant, but the inference model (client-side Gemini) is superseded. See **[Edge Agent](../../edge-agent.md)** for current architecture.

**Date:** 2026-05-28  
**Status:** Implemented  
**Depends on:** `2026-05-28-edge-agent-chat-architecture.md`  
**Scope:** Local-only airgap, stale cloud sync prevention, and the escalation handoff payload contract.

---

## 1. Problem

The base Edge Agent spec enables escalation to Firebase, but has two gaps:

1. **Privacy Breach Risk:** A "Local Only" character can still trigger `escalate_to_cloud` if the LLM decides to — there is no hard enforcement.
2. **Stale Cloud Context:** When a cloud-synced character escalates after many local-only messages, the Firebase agent wakes up with no knowledge of the recent conversation, leading to contradictory or confused replies.

---

## 2. Local-Only Airgap (`useEdgeAgent`)

### 2.1 `isCloudSynced` Prop

`useEdgeAgent` accepts a new option:

```typescript
// src/hooks/useEdgeAgent.ts

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
  memoryBlock?: string
  isCloudSynced: boolean  // NEW — derived from character.save_to_cloud or equivalent
}
```

### 2.2 Conditional Tool Injection

The `escalate_to_cloud` tool is **only** registered when the character is permitted to use the cloud:

```typescript
const functionDeclarations = [getCurrentTimeManifest.schema]

if (options.isCloudSynced) {
  functionDeclarations.push(escalateToCloudManifest.schema)
}

const tools = [{ functionDeclarations }]
```

**Result:** A local-only character's LLM literally cannot escalate — it has no `escalate_to_cloud` function in its tool list. If asked to do something requiring the cloud, it naturally responds: *"I'm running in local-only mode and can't access your deep cloud memory right now."*

---

## 3. Message Sync Tracking (SQLite Schema)

### 3.1 Local SQLite Migration

**Migration number:** `18` (next after current `SCHEMA_VERSION = 17`)

**File:** `src/database/schema.ts`

```typescript
export const SCHEMA_VERSION = 18

export const MIGRATIONS: Record<number, string> = {
  // ...existing migrations 2-17...
  18: `ALTER TABLE messages ADD COLUMN synced_at INTEGER;`,  // NULL = unsynced, Unix timestamp = synced
}
```

**Migration skip guard (for legacy DBs that already have the column):**
```typescript
export const MIGRATION_SKIP_GUARDS: Record<number, MigrationSkipGuard[]> = {
  // ...existing guards...
  18: [{ table: 'messages', column: 'synced_at' }],
}
```

### 3.2 `LocalMessage` Interface Update

**File:** `src/database/messageDatabase.ts`

```typescript
export interface LocalMessage {
  id: string
  character_id: string
  sender_user_id: string
  recipient_user_id: string | null
  text: string
  created_at: number
  message_data: string
  pending: number
  sent: number
  error: number
  edited: number
  synced_at: number | null  // NEW — null = not synced to cloud
}
```

### 3.3 Helper Functions

```typescript
// src/database/messageDatabase.ts

export async function getUnsyncedMessages(
  characterId: string,
  userId: string,
): Promise<LocalMessage[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalMessage>(
    `SELECT * FROM messages 
     WHERE character_id = ? AND synced_at IS NULL 
     ORDER BY created_at ASC`,
    [characterId],
  )
}

export async function markMessagesAsSynced(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return
  const db = await getDatabase()
  const now = Date.now()
  const placeholders = messageIds.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE messages SET synced_at = ? WHERE id IN (${placeholders})`,
    [now, ...messageIds],
  )
}
```

---

## 4. SyncMessage Payload (Lightweight Format)

### 4.1 Interface

```typescript
// src/services/syncMessage.ts

export interface SyncMessage {
  id: string                    // message_id for cloud deduplication
  role: 'user' | 'model'       // LLM role mapping
  text: string                  // message content only
  createdAt: number             // Unix timestamp for ordering
}
```

### 4.2 Mapping from `LocalMessage`

```typescript
// src/services/syncMessage.ts

export function toSyncMessage(
  msg: LocalMessage,
  userId: string,
): SyncMessage {
  return {
    id: msg.id,
    role: msg.sender_user_id === userId ? 'user' : 'model',
    text: msg.text,
    createdAt: msg.created_at,
  }
}
```

---

## 5. Escalation Handoff (Fat Payload)

### 5.1 Flow in `useAIChat`

```typescript
// src/hooks/useAIChat.ts (escalation block)

const edgeResult = await edgeAgent.sendMessage(userText)

if (edgeResult.escalated) {
  // 1. Gather unsynced local messages
  let unsyncedLocal = await getUnsyncedMessages(character.id, userId)

  // GOTCHA 1: Filter out current message if already saved locally (avoids double-count)
  // The current user message may have been inserted into SQLite before escalation fires.
  // If so, exclude it from unsyncedHistory to prevent Firebase receiving it twice.
  unsyncedLocal = unsyncedLocal.filter((msg) => {
    // Exclude by text + recent timestamp (inserted within last 10s)
    return !(msg.text === userText && Date.now() - msg.created_at < 10000)
  })

  const unsyncedHistory = unsyncedLocal.map((msg) => toSyncMessage(msg, userId))

  // 2. Call Firebase with fat payload
  const reply = await generateChatReply({
    characterId: character.id,
    currentMessage: userText,
    unsyncedHistory,  // NEW field
  })

  // 3. Persist AI reply locally — mark as synced (GOTCHA 2)
  // Cloud replies should not be re-synced on next escalation.
  await saveAIMessage(character.id, userId, reply.text, reply.messageId, {
    ...,
    syncedAt: Date.now(),  // NEW — prevents re-syncing cloud-originated messages
  })

  // 4. Mark local messages as synced
  await markMessagesAsSynced(unsyncedLocal.map((m) => m.id))
}
```

**Gotcha 1 — Current Message Double-Count:** If the UI saves the user's message to SQLite before calling `getUnsyncedMessages()`, it appears in both `unsyncedHistory` and `currentMessage`. The filter above excludes it by matching `text` + recent `created_at`. For a more precise filter, track the inserted message ID and exclude by ID.

**Gotcha 2 — Cloud Reply Sync State:** `saveAIMessage` must accept an optional `syncedAt` parameter. When the reply originates from the cloud, set `syncedAt: Date.now()` so the message is not re-synced on the next escalation.

### 5.2 Firebase Callable Input

**File:** `functions/src/generateReply.ts`

```typescript
export interface GenerateReplyInput {
  characterId: string
  currentMessage: string
  unsyncedHistory?: SyncMessage[]  // NEW — lightweight sync payload
}
```

### 5.3 Cloud Processing (Atomic Operation)

```typescript
// functions/src/generateReply.ts (cloud handler)

if (input.unsyncedHistory && input.unsyncedHistory.length > 0) {
  // Bulk insert with idempotency guard
  await db.insert(messages)
    .values(input.unsyncedHistory.map((msg) => ({
      messageId: msg.id,
      characterId: input.characterId,
      senderUserId: msg.role === 'user' ? userId : character.userId,
      text: msg.text,
      createdAt: new Date(msg.createdAt),
      messageData: {},
    })))
    .onConflictDoNothing({ target: messages.messageId })  // IDEMPOTENCY
}

// ...proceed with @google/adk agent execution using full context
```

**Idempotency note:** Mobile networks drop. If the phone sends the escalation, Firebase processes it, but the response is lost, the phone retries with the same `unsyncedHistory`. `.onConflictDoNothing({ target: messages.messageId })` prevents duplicate rows.

---

## 6. Acceptance Criteria

| Test | Expected |
|------|----------|
| Local-only character, `escalate_to_cloud` not in tool list | Firebase never called; LLM responds with local-only fallback message |
| Cloud-synced character escalates | `unsyncedHistory` sent; Firebase bulk-inserts with `ON CONFLICT DO NOTHING` |
| Migration 18 runs on app startup | `synced_at` column exists; `getUnsyncedMessages()` works |
| Retry after network failure | Cloud dedupes on `messageId`; no duplicate messages |
| SyncMessage payload | Contains only `{id, role, text, createdAt}` — no `IMessage` bloat |

---

## 7. Files Changed

| File | Change |
|------|--------|
| `src/database/schema.ts` | Add migration 18 (`synced_at` column); update `SCHEMA_VERSION` to 18 |
| `src/database/messageDatabase.ts` | Add `synced_at` to `LocalMessage`; add `getUnsyncedMessages()`, `markMessagesAsSynced()`; update `saveAIMessage` to accept `syncedAt` |
| `src/services/syncMessage.ts` | **New** — `SyncMessage` interface + `toSyncMessage()` mapper |
| `src/hooks/useEdgeAgent.ts` | Add `isCloudSynced` to options; conditionally inject `escalateToCloudManifest` |
| `src/hooks/useAIChat.ts` | Add unsynced history query + `markMessagesAsSynced()` after escalation; filter current message from sync payload; mark cloud replies as synced |
| `functions/src/generateReply.ts` | Accept `unsyncedHistory`; bulk insert with `.onConflictDoNothing()` |

---

## 8. Design Decisions

### Why `synced_at` timestamp over `isSyncedToCloud` boolean
- Debuggable: "When was this message synced?"
- Enables future "sync since X" incremental sync features
- Matches the user's explicit choice during brainstorming

### Why lightweight `SyncMessage` over full `IMessage`
- `IMessage` contains frontend UI state (avatars, pending flags, nested objects)
- `SyncMessage` is ~80% smaller on the wire
- Cloud can bulk-insert directly without sanitization

### Why `.onConflictDoNothing()` on cloud insert
- Mobile networks are unreliable
- Prevents duplicate rows when the phone retries after a dropped response
- `messageId` (not the UUID primary key) is the deduplication target since it's stable across client/server
