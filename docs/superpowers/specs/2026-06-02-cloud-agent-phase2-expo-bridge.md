# Cloud Agent — Phase 2: Expo Bridge

**Date:** 2026-06-02
**Status:** Ready to implement
**Epic:** Epic 2 — Cloud Agent
**Goal:** Wire the Expo app to call the Cloud Agent via HTTP instead of Firebase `generateReply` when a cloud-synced character escalates.

---

## 1. Context & Motivation

Phase 1 shipped a stateless ADK Cloud Agent on Cloud Run, secured with Firebase ID tokens (`POST /agent/run`). The Expo app currently routes all escalated messages to Firebase `generateReply` (a Cloud Function). Phase 2 cuts over cloud-synced characters to the Cloud Agent, giving them access to persistent tasks and wiki memory.

**No Firebase Functions are modified.** The Firebase path remains for non-cloud-synced characters and as fallback when `EXPO_PUBLIC_CLOUD_AGENT_URL` is not configured.

---

## 2. Architecture

### Current escalation path

```
useEdgeAgent.sendMessage() → escalated=true
  → sendMessageWithAIResponse() → generateChatReply() → Firebase generateReply
```

### Target path (Phase 2)

```
useEdgeAgent.sendMessage() → escalated=true
  ├─ isCloudSynced + EXPO_PUBLIC_CLOUD_AGENT_URL set
  │    → callCloudAgent() → POST /agent/run (Cloud Agent)
  └─ else
       → sendMessageWithAIResponse() → Firebase generateReply (unchanged)
```

### Auth

`auth.currentUser.getIdToken()` from `@react-native-firebase/auth` (already exported from `~/config/firebaseConfig`). The token is passed as `Authorization: Bearer <token>`. No App Check — Cloud Agent does not enforce it.

### Payload

```typescript
// Request
{
  message: string        // current user text
  characterId: string    // character.cloud_id (Cloud SQL UUID — NOT character.id which is local-only)
  history?: Content[]    // prior turns in @google/genai Content[] format (excludes current message)
  unsyncedHistory?: {    // local tasks to upsert before ADK session starts
    type: 'task'
    id: string
    title: string
    status: string
    createdAt: number
  }[]
}

// Response
{
  reply: string          // agent's final text
  toolCalls?: string[]   // tool names invoked (for logging)
}
```

**History:** Built with `buildContentHistory(recentHistory, userId)` from `CharacterPromptBuilder`. Uses 20 recent messages (Cloud Agent has no 12 KB Firebase payload limit). Current user message excluded — sent as `message` separately.

**`characterId` must be `character.cloud_id`** (the Cloud SQL UUID). `character.id` is a local-only SQLite identifier — sending it causes Cloud Agent DB queries to silently return zero results. If `character.cloud_id` is null (not yet synced), skip the Cloud Agent path entirely and fall through to Firebase.

**unsyncedHistory:** All local tasks for the character from `listTasks(characterId)`. The Cloud Agent uses `onConflictDoNothing()` so re-sending already-synced tasks is safe.

**No billing:** Phase 1 has no credits deduction. Cloud Agent path returns `{ usageSnapshot: null }`.

---

## 3. Local Development Networking

React Native cannot reach `localhost` — it refers to the simulator/device itself. To hit the Docker container from the Expo simulator:

```
EXPO_PUBLIC_CLOUD_AGENT_URL=http://<YOUR_MACHINE_LOCAL_IP>:8080/agent/run
```

Find your local IP: `ifconfig | grep "inet " | grep -v 127.0.0.1` (macOS).

Production value: the Cloud Run HTTPS URL.

---

## 4. Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/services/cloudAgentService.ts` | HTTP client: token fetch, `fetch` POST, response parse |
| Create | `__tests__/cloudAgentService.test.ts` | Unit tests for cloudAgentService |
| Modify | `src/hooks/useAIChat.ts` | Route escalated+isCloudSynced to Cloud Agent |
| Modify | `__tests__/useAIChat.test.tsx` | Tests for Cloud Agent routing in useAIChat |
| Modify | `.env.example` | Add `EXPO_PUBLIC_CLOUD_AGENT_URL=` |

---

## 5. Non-Goals

- No streaming / SSE
- No credits deduction (Phase 3)
- No wiki event sync in `unsyncedHistory` (wiki RAG handled server-side via pre-fetch; wiki sync is a separate `wikiSyncFn` flow)
- No changes to Firebase Functions
- No changes to `cloud-agent/` (Phase 1 backend is complete)

---

## 6. Acceptance Criteria

| Scenario | Expected |
|---|---|
| `isCloudSynced=true` + `cloud_id` set + URL configured + escalated | Cloud Agent called with `characterId=cloud_id`; reply saved locally; `usageSnapshot: null` |
| `isCloudSynced=true` + `cloud_id` is null + escalated | Falls through to Firebase `generateReply` (character not yet synced to cloud) |
| `isCloudSynced=true` + URL not configured + escalated | Falls through to Firebase `generateReply` (unchanged) |
| `isCloudSynced=false` + escalated | Firebase `generateReply` (unchanged) |
| Cloud Agent returns 401/500 | `mutationFn` throws; `onError` rolls back optimistic update; error state set |
| `listTasks` returns tasks | Tasks sent as `unsyncedHistory` with `type: 'task'` |
| Prior conversation history | Sent as `Content[]` (up to 20 messages, current message excluded) |
