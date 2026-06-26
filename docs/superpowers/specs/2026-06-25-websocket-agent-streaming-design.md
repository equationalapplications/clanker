# WebSocket Agent Streaming — Design Spec

**Date:** 2026-06-25
**Status:** Implemented

---

## Goal

Replace the single-awaited HTTP response model of `/agent/run` with server-sent event streaming via WebSocket on a new `/agent/stream` endpoint. Users see AI replies token-by-token and real-time tool-call visibility (e.g., "Reading your memory..."), drastically reducing perceived latency during multi-step agent reasoning loops. The HTTP endpoint remains fully intact for backward compatibility with legacy mobile clients. No breaking changes, zero-downtime migration.

---

## Architectural Principles

1. **Coexistence, not replacement:** Both `/agent/run` (HTTP) and `/agent/stream` (WebSocket) operate in parallel. Legacy app clients continue to use HTTP indefinitely.
2. **Shared core, isolated transports:** Extract ADK setup (`buildAgent`, tool registration, system prompt assembly) into a shared utility. HTTP and WebSocket handlers reuse this core but maintain separate credit sagas (duplication is acceptable to isolate billing logic).
3. **Server-owned disconnect logic:** Disconnect/refund handling lives entirely on the server via WebSocket event listeners. No new frontend caching or ACK complexity.
4. **Lightweight transport:** Native `ws` library only; no socket.io. Minimizes backend container and frontend bundle size.

---

## Architecture

### New Files

| File | Responsibility |
|---|---|
| `cloud-agent/src/services/agentCore.ts` | Shared ADK setup: `buildAgent(db, userId, characterId, systemInstruction, timezone, embed)`, tool registration, system prompt assembly. Exported for reuse by both HTTP and WebSocket handlers. |
| `cloud-agent/src/handlers/wsAgentHandler.ts` | WebSocket `/agent/stream` handler: stateful auth handshake, parallel credit saga, disconnect listener, ADK event→JSON streaming. |

### Modified Files

| File | Change |
|---|---|
| `cloud-agent/src/index.ts` | Extract HTTP `/agent/run` handler core logic into `agentCore.ts`. Attach WebSocket server via `ws` library on `/agent/stream`. Keep HTTP handler unchanged for regression safety. |
| `cloud-agent/src/agent.ts` | Move `buildAgent(...)` function to `agentCore.ts`. Re-export from there in tests and HTTP handler. |
| `cloud-agent/package.json` | Add `ws` dependency (native WebSocket library). |
| `src/services/cloudAgentService.ts` (frontend) | Add WebSocket client with optional streaming callbacks (`onToken`, `onToolStart`, `onToolEnd`). If WebSocket connection or auth handshake fails, retry with `POST /agent/run` HTTP endpoint. Mid-stream drops show error toast; user manually retries. |
| `src/hooks/useAIChat.ts` | Capture WebSocket stream events via `callCloudAgent` callbacks; expose `activeTool: string \| null` and `streamingMessage: IMessage \| null` for real-time UI updates during the Cloud Agent path. |
| `src/components/ChatView.tsx` | Read `activeTool` from the hook and render a dynamic status indicator in the existing top banner (`accessibilityLiveRegion="polite"`). Prepend `streamingMessage` to GiftedChat messages so reply text streams token-by-token. |
| Cloud Run deployment config (`cloud-agent/scripts/deploy.sh`) | Set container memory: **512MiB** (up from prior), request timeout: **540 seconds** (9 minutes). Rationale: ADK multi-step tool execution (wiki reads, web searches, task management) requires sustained memory and long timeout to avoid premature Cloud Run eviction. Precedent: `convertDocumentText` callable. |

---

## Technical Specifications

### MVP JSON Event Contract

**Client → Server**

Auth handshake (must arrive within 5 seconds of connection):
```json
{
  "type": "auth",
  "token": "<firebaseIdToken>"
}
```

Agent execution request (after auth succeeds):
```json
{
  "type": "agent_run",
  "message": "string (user prompt, required, non-empty)",
  "characterId": "uuid (required, must exist and belong to user)",
  "unsyncedHistory": [
    { "type": "task", "id": "...", "title": "...", "status": "...", "createdAt": number },
    { "type": "wiki_entry", "id": "...", "body": "...", "createdAt": number, "updatedAt": number },
    { "type": "wiki_event", "id": "...", "eventType": "observation|decision|action|outcome", "summary": "...", "createdAt": number }
  ],
  "history": [
    { "role": "user|model", "parts": [ { "text": "..." } ] }
  ],
  "timezone": "string (optional, defaults to 'UTC')"
}
```

**Server → Client (streaming)**

Real-time tool visibility (fires when ADK begins tool invocation):
```json
{
  "type": "tool_start",
  "name": "string (tool name, e.g., 'wiki_read', 'google_search')"
}
```

Tool completion (fires when tool finishes, before LLM generates text tokens):
```json
{
  "type": "tool_end",
  "name": "string (tool name, matches corresponding tool_start)"
}
```

Streamed response token (fires repeatedly as LLM generates):
```json
{
  "type": "token",
  "text": "string (single or partial token)"
}
```

Terminal event (final state after agent loop completes):
```json
{
  "type": "usage_snapshot",
  "remainingCredits": "number (user's remaining credit balance after spend)"
}
```

Error event (fired if auth fails, user not found, or other fatal errors; socket closes after):
```json
{
  "type": "error",
  "code": "string (e.g., 'UNAUTHORIZED', 'CHARACTER_NOT_FOUND', 'INSUFFICIENT_CREDITS')",
  "message": "string (human-readable error)"
}
```

---

### Connection & Authentication Flow

**Step 1: Client Connects**
- Client initiates WebSocket: `new WebSocket('wss://cloud-agent.example.com/agent/stream')`
- Server accepts connection, pauses. Awaits first message within 5-second timeout.

**Step 2: Auth Handshake**
- Client sends: `{ type: 'auth', token: '<firebaseIdToken>' }`
- Server extracts token, validates via `admin.auth().verifyIdToken(token)` (identical to HTTP middleware)
- Server maps Firebase UID → internal `userId` via Cloud SQL `users.firebase_uid` lookup
- On validation success: send ACK (implicit; proceed to step 3)
- On validation failure or timeout: send `{ type: 'error', code: 'UNAUTHORIZED', message: '...' }`, close socket with code 4001

**Step 3: Agent Loop Authorization**
- Server now accepts `{ type: 'agent_run', ... }` payloads
- Only one `agent_run` per connection allowed; subsequent payloads are rejected

---

### Credit Saga (Parallel to HTTP)

**Success Path**

1. Client sends `{ type: 'agent_run', ... }`
2. Server calls `spendCredit(userId)` → captures `transactionId`, sets `isCompleted = false`
3. Server attaches listeners to socket `close` and `error` events
4. Server queries wiki context, builds system instruction
5. Server invokes ADK agent loop via `runAgentReal(...)`
6. For each ADK event:
   - If tool invocation starts: send `{ type: 'tool_start', name: '...' }`
   - If tool invocation completes: send `{ type: 'tool_end', name: '...' }`
   - If text part: send `{ type: 'token', text: '...' }` (may split across events)
7. On final ADK response: fetch `newBalance = getBalance(userId)`
8. Send `{ type: 'usage_snapshot', remainingCredits: newBalance }`
9. Set `isCompleted = true`, close socket gracefully (code 1000)

**Failure Path (Disconnect Before Completion)**

If socket emits `close` or `error` and `isCompleted === false`:
1. Immediately call `abortController.abort()` on ADK async generator (cancels remaining token fetches, stops tool execution)
2. Call `refundCredit(userId, transactionId)` to restore the deducted credit
3. Log event: `{ userId, transactionId, event: 'refund_due_to_disconnect', timestamp }`
4. Socket is already closed; no response payload sent

**Failure Path (Pre-Agent Errors)**

If auth, wiki context query, or system instruction assembly fails before agent loop starts:
1. Call `refundCredit(userId, transactionId)`
2. Send `{ type: 'error', code: '...', message: '...' }`, close socket

---

### Frontend Fallback Strategy

**Initial Connection Failure (Connection Refused or Auth Timeout)**
```typescript
try {
  const ws = new WebSocket(wsUrl)
  // Await auth response with 5s timeout (matches server-side auth timeout)
  const authResult = await waitForAuthResponse(ws, 5000)
  if (!authResult.success) throw new Error(authResult.error)
  // Connection and auth succeeded; proceed with agent_run
} catch (err) {
  // Initial connection or handshake failed
  console.warn('WebSocket fallback to HTTP:', err)
  return cloudAgentService.run(req) // POST /agent/run (HTTP)
}
```

**Mid-Stream Drop (After Auth, During Agent Execution)**
- Do NOT attempt to resume, reconnect, or fallback to HTTP
- Reason: Resuming after credit spend creates risk of double-charging if the server-side refund hasn't completed
- Instead: Show error toast: `"Connection lost. Tap to retry."`
- Rely on server-side disconnect listener to cleanly abort and refund
- User manually taps "retry" to start a fresh agent execution

---

### Frontend UI — Real-Time Tool & Token Display

**`useAIChat.ts`**
- During the Cloud Agent path, pass streaming callbacks to `callCloudAgent`:
  - `onToolStart(name)` → set `activeTool = name`
  - `onToolEnd(name)` → set `activeTool = null`
  - `onToken(text)` → append to `streamingMessage.text`
- Initialize `streamingMessage` as a temporary character-authored `IMessage` when the cloud request starts; clear `activeTool` and `streamingMessage` in `onMutate` / `onSettled`.
- Return `{ activeTool, streamingMessage }` alongside existing hook values.

**`ChatView.tsx`**
- Merge `streamingMessage` into GiftedChat: `displayMessages = streamingMessage ? [streamingMessage, ...messages] : messages`.
- In the existing top banner container (`accessibilityLiveRegion="polite"`), render tool-specific status when `activeTool` is set:

| Tool name | Banner text |
|---|---|
| `wiki_read` | ⏳ Reading your memory… |
| `google_search` | ⏳ Searching the web… |
| *(other)* | ⏳ Using {tool_name}… |

- Suppress the generic "💭 Thinking…" banner once `activeTool` is set or `streamingMessage.text` is non-empty (tool/status or streamed tokens provide feedback instead).

---

### Error Codes & Handling

| Code | Condition | HTTP Status (if applicable) | Socket Close Code |
|---|---|---|---|
| `UNAUTHORIZED` | Invalid token, token expired, or UID lookup failed | 401 | 4001 |
| `CHARACTER_NOT_FOUND` | Character does not exist or does not belong to user | 404 | 4004 |
| `INSUFFICIENT_CREDITS` | User has zero credits | 402 | 4402 |
| `INVALID_REQUEST` | Missing required fields in `agent_run` payload | 400 | 4400 |
| `INTERNAL_ERROR` | ADK failure, wiki context failure, or other unrecoverable error | 500 | 1011 |

All error codes are sent as `{ type: 'error', code: '...', message: '...' }` before socket close.

---

### Infrastructure Requirements

**Cloud Run Container**
- Memory: 512MiB (bumped from prior; provides buffer for WebSocket overhead + sustained multi-step tool execution)
- Request timeout: 540 seconds (9 minutes; allows for long wiki queries, web searches, and task management loops)
- Concurrency per instance: default (typically 80–100); WebSocket connections count toward concurrency limits

**Deployment Config**
Update `cloudbuild.yaml` or `app.yaml`:
```yaml
# cloudbuild.yaml example
steps:
  - name: 'gcr.io/cloud-builders/gke-deploy'
    args:
      - run
      - '--filename=.'
      - '--location=us-central1'
      - '--cluster=...'
    env:
      - 'CLOUDSDK_COMPUTE_REGION=us-central1'
      - 'CLOUDSDK_CONTAINER_CLUSTER=...'

# OR app.yaml
runtime: nodejs20
env: standard
entrypoint: node dist/index.js
env_variables:
  NODE_ENV: production
handlers:
  - url: /.*
    script: auto
resources:
  cpu: 1
  memory_gb: 0.512
  disk_size_gb: 1
timeout: 540s
```

---

## Testing Strategy

### Unit Tests
- `agentCore.test.ts`: Test `buildAgent()` produces identical output for identical inputs (HTTP and WebSocket share this)
- `wsAgentHandler.test.ts`: Test auth validation, credit saga, disconnect listener behavior
  - Auth success path (valid token)
  - Auth failure path (invalid token, timeout)
  - Mid-stream disconnect → refund
  - Pre-agent error → refund
  - Event serialization (tool_start, tool_end, token, usage_snapshot)
  - `useAIChat` streaming callbacks wired to `callCloudAgent`
  - `ChatView` banner renders `activeTool` labels; GiftedChat shows `streamingMessage`

### Integration Tests
- HTTP `/agent/run` continues to pass all existing tests (regression guard)
- WebSocket `/agent/stream` vs. HTTP `/agent/run` produce identical reply text for identical input (contract parity)
- Credit balance reconciliation: HTTP spend + WebSocket spend + refunds = expected balance

### Manual QA
- Open WebSocket on slow 3G connection; simulate mid-stream disconnect → verify server refunds credit
- Auth timeout: delay client auth message >5s → verify socket closes with 4001
- Token refresh: test with expired Firebase token → verify 4001 close, no credit deduction
- Tool visibility: wiki_read, google_search → verify `tool_start` events stream in real-time
- Fallback: break WebSocket endpoint, verify frontend falls back to HTTP and executes successfully

---

## Rollout Strategy

**Phase 1: Backend Implementation & Testing**
- Implement `agentCore.ts`, `wsAgentHandler.ts`
- All tests pass; HTTP endpoint remains unmodified and fully functional
- Deploy to staging; run integration tests

**Phase 2: Frontend Fallback Implementation**
- Add WebSocket + fallback logic to `cloudAgentService.ts`
- Feature flag: WebSocket enabled/disabled via environment variable
- Canary: 5% of Expo app clients → WebSocket (95% continue HTTP)
- Monitor: connection success rate, refund event frequency, error logs

**Phase 3: Full Rollout**
- Gradually increase WebSocket percentage (10% → 25% → 50% → 100%)
- Maintain HTTP endpoint indefinitely for legacy app versions and fallback
- No breaking changes; legacy clients never forced to upgrade

---

## Success Criteria

1. **Zero Regression:** HTTP `/agent/run` endpoint behaves identically to pre-spec behavior. All existing tests pass.
2. **Perceived Latency:** Users see first reply token within 2–3 seconds of sending a message (vs. 8–12s for full HTTP response).
3. **Tool Visibility:** Tool-call intents (`wiki_read`, `google_search`, etc.) stream in real-time; users see "Reading your memory..." or "Searching the web..." before reply text arrives.
4. **Credit Safety:** Zero unrefunded charges on disconnect. 100% of mid-stream drops trigger `refundCredit` and log refund events.
5. **Backward Compatibility:** Legacy Expo app clients (pre-WebSocket version) continue to function indefinitely via HTTP endpoint.

---

## Out of Scope (Future)

- Streaming raw tool results (wiki chunks, search results) — MVP avoids this to reduce socket bloat
- Server-Sent Events (SSE) alternative — WebSocket is the primary choice; SSE can be evaluated later if HTTP/2 server push becomes necessary
- Multi-modal streaming (images, audio as base64) — Deferred pending Firebase Storage integration (separate epic)
- Offline WebSocket queueing — Offline agent execution queuing is out of scope; users retry when online

---

## References

- **Existing HTTP Credit Saga:** `/cloud-agent/src/index.ts` (lines 394–456)
- **ADK Integration:** `/cloud-agent/src/agent.ts`, `/cloud-agent/src/index.ts` (`runAgentReal`)
- **Firebase Auth Verification:** `/cloud-agent/src/index.ts` (lines 335–352, `requireAuth` middleware)
- **Frontend Cloud Agent Service:** `/src/services/cloudAgentService.ts`
- **Infrastructure Precedent:** `convertDocumentText` callable Cloud Function (512MiB memory, 540s timeout)

