# MV3 Browser Extension Remote Agent Bridge — Design Spec

**Date:** 2026-06-29
**Status:** Implemented
**Supersedes:** `2026-04-24-browser-extension-remote-agent-design.md` (April draft — replaced by this spec)

---

## Overview

Goal: let Clanker (mobile voice or text) instruct a trusted MV3 browser extension on the user's desktop to perform browser tasks — reading pages, extracting data, navigating, and (Phase 2+) submitting forms — within the user's existing authenticated sessions.

Core value: cross-device agent execution, not a generic automation platform.

CWS single-purpose statement:
> "Clanker companion extension that lets your Clanker agent perform web tasks you explicitly request on this browser."

---

## Infrastructure Prerequisites

This feature introduces greenfield infrastructure not present in the Clanker repo today. Provision and deploy these before Phase 1 implementation:

| Prerequisite | Purpose | Owner |
|--------------|---------|-------|
| **Firestore** (Native mode) | Session/task/auth coordination bus; replaces in-memory cross-instance routing | GCP console — enable in existing Firebase project |
| **Firestore Security Rules** | Tenant isolation; client read-only on tasks; server-owned writes | Deploy via `firebase deploy --only firestore:rules` |
| **FCM Sender ID** | `chrome.gcm.register()` in extension | Firebase console → Project Settings → Cloud Messaging |
| **Cloud Agent Firestore Admin SDK** | `firestoreSession.ts` read/write helpers | Use `admin.firestore()` via existing `firebase-admin` — no additional dep required |
| **Expo Push** (Phase 2+) | Approval cards, async task completion | `expo-notifications` in mobile app; token registration pipeline |

**Not in scope today:** Cloud Agent uses Postgres/Drizzle for agent data and `firebase-admin` for auth verification only. Mobile app has no push notification infrastructure. The extension directory does not exist.

**Session TTL:** Configure Firestore TTL on `users/{uid}/sessions/{sessionId}.expiresAt` (+30 min) to clean orphaned sessions. Cloud Monitoring alert on listener count per Cloud Run instance.

---

## Architecture Overview

Three-node async loop. All cross-node communication is event-driven through Firestore; no Cloud Run instances communicate directly.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD COORDINATOR                        │
│                    (Cloud Agent / Cloud Run)                     │
│                                                                 │
│  /agent/live ──── sessionBridge (in-memory) ── /agent/browser  │
│       ↑                    │                          ↑         │
│       │             Firestore Bridge                  │         │
│       │         users/{uid}/sessions/{sid}/           │         │
│       │                    ↓                          │         │
│  Gemini Live           task docs              Extension WS      │
│  Bidi Audio        result docs               (on WAKE only)    │
│                    auth docs                                     │
└─────────┬──────────────────┬─────────────────────────┬──────────┘
          │                  │                          │
          ▼                  ▼                          ▼
   Mobile App          Expo Push                MV3 Extension
   (Voice I/O)      Notifications              (Desktop Browser)
   /agent/live      async results              FCM silent push
   WebSocket        approval cards             → WS on wake
```

**Three nodes:**

| Node | Role | Connection |
|------|------|-----------|
| Mobile App | Voice I/O, approval UI, Expo Push receiver | `/agent/live` WS (when in call) |
| Cloud Coordinator | Pub/sub router, Firestore writer, FCM dispatcher | In-memory session map per Cloud Run instance |
| MV3 Extension | DOM executor, sensory organ | Idle (FCM) → Active (`/agent/browser` WS) |

**Key invariant:** Cloud Run instances never communicate directly. All cross-socket routing flows through Firestore. Voice session and browser session are independently owned by whichever instance accepted the WS upgrade — they rendezvous only through Firestore documents.

**`sessionBridge` scope:** The in-memory session map exists for same-instance optimization only. Browser task results are always written to Firestore first; the voice-side instance picks them up via its own Firestore listener. `voiceWs` in `sessionBridge` is not the primary result-delivery path — Firestore is.

**Per-container instance identity:** `K_REVISION` identifies a deployment revision, not an individual Cloud Run container. A module-scoped constant is generated once per process:

```typescript
// cloud-agent/src/index.ts (or sessionBridge.ts)
export const INSTANCE_ID = crypto.randomUUID()
```

Used for `voiceInstanceId` (session doc) and `browserInstanceId` (`markBrowserConnected`). Enables true per-container tracking for same-instance shortcuts and observability.

---

## Triggering Browser Tasks: `browser_action` Tool

Gemini Live has no knowledge of the browser extension without an explicit tool in its schema. The `browser_action` tool is the sole trigger that initiates the Wake-and-Connect pipeline from the voice or text agent.

### Tool Implementation (ADK `FunctionTool`)

`browser_action` is **not** registered in `shared/agent-tools-spec.ts`. That file is consumed only by the edge agent (`useEdgeAgent`) and Firebase `generateReply` — `getSchemasForCloud()` has no callers in the Cloud Agent path. Gemini Live and `/agent/run` both inject tools via ADK `FunctionTool` objects.

Implemented in `cloud-agent/src/tools/browserAction.ts` as an ADK `FunctionTool` with a strict Zod parameter schema (mirrors the Task DSL envelope). Dual-wired into both agent entry points:

| Entry point | Injection site | File |
|-------------|----------------|------|
| Voice (`/agent/live`) | `adkTools` array in `buildLiveTools` | `cloud-agent/src/services/liveToolAdapter.ts` |
| Text (`/agent/run`) | `tools` array in `buildAgent` | `cloud-agent/src/services/agentCore.ts` |

The edge agent cannot invoke `browser_action` — it requires Cloud Agent, Firestore coordination, and a registered desktop extension. Text chat reaches it via `/agent/run` (cloud escalation) or live voice on `/agent/live`.

```typescript
// cloud-agent/src/tools/browserAction.ts — Zod schema (excerpt)
const browserActionSchema = z.object({
  actionSummary: z.string().describe(
    'Human-readable description of what you are about to do. Phase 1: audit log + voice narration. Phase 2+: shown in approval card.',
  ),
  intent: z.object({
    action: z.record(z.unknown()).describe('SingleAction or SequenceAction — see Task DSL spec.'),
  }),
})

export function browserActionTool(
  deps: BrowserActionDeps,
  context: { trigger: 'voice' | 'text'; preBilled: boolean },
): FunctionTool { /* ... */ }
```

`BrowserActionDeps` bundles `firestoreSession`, `fcmDispatcher`, `creditService`, and `uid`. The `context` parameter drives contextual billing (see below).

**`actionSummary` in Phase 1:** Audit log and voice narration only (e.g. "Checking the article on your browser…"). No approval UI until Phase 2.

### Tool Invocation Flow

The tool handler is the **sole owner** of bridge `sessionId` and `taskId` generation. Each `browser_action` call creates a new bridge session — independent of the Gemini Live WS connection ID.

```
Gemini calls browser_action({ actionSummary, intent })
  → browserActionTool.execute():
      1. sessionId = crypto.randomUUID()
         taskId   = crypto.randomUUID()
      2. device = firestoreSession.getActiveDevice(uid)
         → if null: return tool_response error immediately (NO credit spent):
              "No browser extension is paired. Install the Clanker Desktop Bridge extension."
      3. Billing (contextual — see Billing section):
         if context.preBilled (text /agent/run): skip spendCredit
         else (voice /agent/live): txId = creditService.spendCredit(uid)
      4. firestoreSession.createSession(uid, sessionId, {
           status: 'pending', trigger: 'voice' | 'text',
           voiceInstanceId: INSTANCE_ID,
         })
      5. Build TaskIntent { version: '1', taskId, sessionId, requiresAuth, actionSummary, action }
      6. firestoreSession.writeTask(uid, sessionId, taskId, taskIntent)  // status: pending
      7. fcmDispatcher.wakeExtension(device.fcmToken, sessionId, taskId)
      8. Start 12s durable wake timeout (see Wake Timeout section)
      9. Result delivery (path-dependent):
         VOICE: register watchTask listener; return interim tool_response:
           "Sent task to your browser. I'll read the result when it arrives."
         TEXT:  await watchTask promise via 30s Promise.race (see Text Path Timeout);
                return formatted result/error as tool_response string directly
```

**Voice path (`onResult` callback):**
```
  onResult(taskDoc):
    → if status == "complete":
        format result as tool_response content
        push into Gemini Live session (streams to voice)
        teardown Firestore listener
    → if status == "failed" | "aborted":
        push error message into Gemini Live session
        teardown Firestore listener
```

**Text path (`/agent/run`):** The ADK `InMemoryRunner` expects a synchronous tool return. The executor `await`s a `watchTask` promise that resolves when the task doc reaches a terminal status (`complete` | `failed` | `aborted`). No interim response; the final tool return feeds directly into the agent's text synthesis.

**Text Path Timeout:** The HTTP request must resolve before the GCP HTTP(S) Load Balancer backend service timeout drops the connection. Default GCP LB backend timeout is **30 seconds** (configurable, but do not assume higher without an explicit infra change). The `watchTask` await is therefore wrapped in a `Promise.race` with a 30s hard cap:

```typescript
const result = await Promise.race([
  watchTaskPromise(uid, sessionId, taskId),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject({ code: 'EXECUTION_TIMEOUT', message: 'Browser task exceeded 30s' }), 30_000)
  ),
])
```

This 30s cap covers both the 12s durable wake timeout and up to 18s of execution time — sufficient for all Phase 1 read-only actions. If the extension connects but hangs (content script crash, execution freeze), this timeout fires `EXECUTION_TIMEOUT` and unblocks the HTTP request cleanly. No credit refund on `EXECUTION_TIMEOUT` — the extension connected and attempted the task.

**Cross-instance result delivery:** The voice-side handler owns the per-task `watchTask` listener. When the browser-side instance writes the result to Firestore, the voice-side listener fires on its own instance — no direct socket-to-socket communication required. This is the correct cross-instance path; `sessionBridge.voiceWs` is only checked as a short-circuit when both sockets happen to land on the same instance.

**Credit billing (contextual):**

| Invocation context | Timer billing | `browser_action` flat billing |
|--------------------|--------------|-------------------------------|
| Voice (`/agent/live`) | `billingTimer` runs per wall-clock interval — **must be paused** on `browser_action` invocation, resumed on tool return | `spendCredit(uid)` after device found; covers wake + execution latency |
| Text (`/agent/run`) | No timer — HTTP handler spends 1 credit before ADK runs | Skip `spendCredit` — turn already billed |

**Timer pause contract (voice path):** `wsLiveAgentHandler` exposes `pauseBilling()` / `resumeBilling()`. The `browser_action` tool handler calls `pauseBilling()` immediately after `getActiveDevice` succeeds (before FCM dispatch) and `resumeBilling()` when `watchTask` resolves, the durable wake timeout fires (`EXTENSION_OFFLINE`), or the voice execution timeout fires (`EXECUTION_TIMEOUT`). Without this pause, the user is charged per-interval for every second spent waiting for extension wake and execution — silent double-billing.

**Voice Path Timeout:** The voice path returns an interim tool response immediately and delivers the final result out-of-band via `pushToLive`. Like the text path, the out-of-band `watchTask` await is wrapped in a `Promise.race` with the same 30s hard cap. If the extension connects but hangs, `resumeBilling()` still runs and the user hears the `EXECUTION_TIMEOUT` message. No credit refund on `EXECUTION_TIMEOUT`.

Refund on `EXTENSION_OFFLINE` (durable wake timeout) or other pre-execution failures applies only when a credit was spent (voice path). No refund for execution errors (`SELECTOR_NOT_FOUND`, `EXECUTION_TIMEOUT`, etc.) — the extension connected and attempted the task. No credit spent when no device is registered.

---

## Session Lifecycle: Wake-and-Connect

Extension is idle (zero CPU, zero battery) until needed. Chrome's native Web Push / FCM wakes the MV3 service worker only when a task arrives.

### State Machine

```
Extension:
  IDLE ──(FCM WAKE_AND_CONNECT)──► AUTHENTICATING
  AUTHENTICATING ──(WS open + session_ready)──► ACTIVE
  ACTIVE ──(SESSION_END or WS error)──► IDLE

Cloud Coordinator per session:
  PENDING ──(extension WS auth + markBrowserConnected)──► ROUTING
  ROUTING ──(task complete / session end)──► CLOSED
  ROUTING ──(destructive action — Phase 2)──► PENDING_AUTH
  PENDING_AUTH ──(FCM approval tap)──► ROUTING
  PENDING_AUTH ──(deny / 5min timeout)──► ABORTED
  PENDING ──(durable wake timeout, no browserConnectedAt)──► ABORTED
```

### Session Identity

| ID | Scope | Created by |
|----|-------|------------|
| `sessionId` | One bridge session per `browser_action` call | Cloud Agent tool handler (`crypto.randomUUID()`) |
| `taskId` | One task within that bridge session | Cloud Agent tool handler (`crypto.randomUUID()`) |
| Voice WS connection | Gemini Live audio stream | Existing `/agent/live` handler (unrelated ID) |

The extension receives `sessionId` and `taskId` in the FCM payload and must echo `sessionId` in its WS auth frame. The Cloud Agent validates that the session doc exists and `status !== 'closed'`.

### Message Flow (happy path)

```
1.  [Mobile/Scheduler] user intent arrives at Cloud Agent
2.  [Cloud Agent / tool handler] sessionId + taskId = crypto.randomUUID()
3.  [Cloud Agent] createSession(uid, sessionId, { status: 'pending', trigger, voiceInstanceId })
4.  [Cloud Agent] writeTask(uid, sessionId, taskId, taskIntent)  // status: pending
5.  [Cloud Agent] getActiveDevice(uid) → fcmToken; wakeExtension(fcmToken, sessionId, taskId)
      FCM payload: { type: "WAKE_AND_CONNECT", sessionId, taskId }
6.  [Cloud Agent] starts 12-second durable wake timeout; registers watchTask listener
7.  [MV3 service worker] wakes, mints idToken via offscreen auth bridge
8.  [Extension → Cloud Agent] WS auth frame:
      { type: "auth", idToken, sessionId, deviceId }
9.  [Cloud Agent / browser-side instance] verifies token + validates deviceId
10. [Cloud Agent] markBrowserConnected(uid, sessionId, INSTANCE_ID)
      → session doc: { status: 'routing', browserInstanceId, browserConnectedAt }
      → task doc: { status: 'executing' }   // cancels durable wake timeout
11. [Cloud Agent → Extension] { type: "session_ready", sessionId }
12. [Cloud Agent] registers browserWs in sessionBridge (same-instance shortcut only)
13. [Cloud Agent] reads pending task from Firestore, sends to extension via WS
14. [Extension] executes Task DSL, returns result via WS
15. [Cloud Agent / browser-side instance] writeTaskResult → Firestore task doc
16. [Cloud Agent / voice-side instance] watchTask listener fires; pushes result into Gemini Live
    (If voice session closed: voice-side sends Expo Push instead)
17. [Cloud Agent → Extension] { type: "session_end" }
18. [Extension] closes WS; closes offscreen auth doc; service worker suspends
```

### Wake Timeout

Voice and browser WebSockets may land on **different** Cloud Run instances. The wake timeout must **never** consult local `sessionBridge.browserWs` — that only exists on the instance that accepted the browser WS.

If the extension does not authenticate within 12 seconds of FCM dispatch, the voice-side handler queries **durable Firestore state**:

```typescript
setTimeout(async () => {
  const task = await firestoreSession.getTask(uid, sessionId, taskId)
  const session = await firestoreSession.getSession(uid, sessionId)

  // Extension connected on another instance — abort timeout
  const connected =
    task.status === 'executing' ||
    session.browserInstanceId != null ||
    session.browserConnectedAt != null

  if (!connected && task.status === 'pending') {
    await firestoreSession.writeTaskResult(uid, sessionId, taskId, {
      status: 'failed',
      error: {
        code: 'EXTENSION_OFFLINE',
        message: 'Browser extension did not connect',
        failedAction: intent.action,
      },
    })
    await cs.refundCredit(uid, txId)
    await firestoreSession.closeSession(uid, sessionId, 'aborted')
  }
}, 12_000)
```

The voice-side `watchTask` listener (registered at tool invocation) picks up the failed status and speaks: "Your browser extension appears to be offline."

**Auth frame timeout (5s):** Separate from the 12s wake timeout. If the extension opens a WS but does not send an auth frame within 5s, the browser-side handler closes the socket with code 4001. The 12s durable timeout still governs whether the extension connected at all.

---

## Firestore Session Schema

All docs scoped under `users/{uid}/` for tenant isolation. Firebase Security Rules enforce `request.auth.uid == uid`. Cloud Agent service account bypasses via Admin SDK.

### Session document — `users/{uid}/sessions/{sessionId}`

```json
{
  "status": "pending | routing | pending_auth | closed | aborted",
  "trigger": "voice | text | scheduler",
  "voiceInstanceId": "cloud-run-instance-abc",
  "browserInstanceId": "cloud-run-instance-xyz",
  "browserConnectedAt": "<timestamp | null>",
  "createdAt": "<timestamp>",
  "expiresAt": "<timestamp +30min>"
}
```

`browserInstanceId` and `browserConnectedAt` are written by the browser-side Cloud Run instance on successful WS auth. The durable wake timeout checks these fields (or task `status: executing`) — never local `sessionBridge`.

### Task document — `users/{uid}/sessions/{sessionId}/tasks/{taskId}`

```json
{
  "status": "pending | executing | awaiting_auth | complete | failed | aborted",
  "intent": "<TaskIntent — see DSL section>",
  "result": null,
  "error": null,
  "authRequired": false,
  "haltedStepIndex": null,
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}
```

`haltedStepIndex` is set when a sequence halts awaiting destructive action auth (Phase 2). Extension reads this on re-wake to resume from the correct step.

### Auth document — `users/{uid}/sessions/{sessionId}/auth/{taskId}`

```json
{
  "status": "pending | approved | denied",
  "actionSummary": "Submit payment of $42.99 on amazon.com",
  "expiresAt": "<timestamp +5min>",
  "approvedAt": null,
  "approvalToken": null
}
```

Mobile app writes `{ status: "approved", approvalToken: <Firebase ID token> }`. Cloud Agent listener verifies token via Admin SDK before resuming extension.

Approval TTL (5 min) matches Expo Push `ttl: 300`. Expired approval card vanishes from lock screen before user can tap it — no confusing stale-approval errors.

### Device document — `users/{uid}/devices/{deviceId}`

```json
{
  "fcmToken": "...",
  "deviceName": "Home Mac — Chrome",
  "registeredAt": "<timestamp>",
  "lastSeenAt": "<timestamp>",
  "active": true,
  "isPaused": false
}
```

`isPaused` is written by the side panel "Pause Remote Actions" toggle via `POST /agent/browser/register-device` upsert (same endpoint, `isPaused` field added to request body). `getActiveDevice` checks `isPaused` before returning — a paused device returns `null`, preventing credit spend and FCM dispatch. User receives a tool error: "Remote browser actions are paused. Enable them from the Clanker Desktop Bridge extension."

### Device Selection

Phase 1 supports a single active desktop. The Cloud Agent resolves the wake target before spending credits:

```typescript
// firestoreSession.getActiveDevice(uid)
// Query: users/{uid}/devices where active === true AND isPaused === false,
//        orderBy lastSeenAt desc, limit 1
// Returns: { deviceId, fcmToken, deviceName } | null
```

| Outcome | Behavior |
|---------|----------|
| No device doc | Return tool error immediately; **no credit spent** |
| Device found but `isPaused: true` | Return tool error immediately; **no credit spent** |
| Device found, not paused | FCM wake → durable timeout; `spendCredit` only on voice path (text path pre-billed) |
| Multiple active devices (Phase 2+) | Most recently seen wins until explicit primary-device selection is added |

Extension updates `lastSeenAt` on every successful WS auth via `POST /agent/browser/register-device` upsert. The extension re-POSTs on `session_ready` (after the Cloud Agent accepts the auth frame) so `lastSeenAt` reflects active bridge sessions, not only install/sign-in.

### Security Rules

Clients (mobile app, extension) must **not** write task status or results. All task lifecycle transitions are owned by the Cloud Agent Admin SDK.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

  match /users/{uid}/sessions/{sessionId} {
    allow read: if request.auth.uid == uid;
    allow write: if false;  // Admin SDK only (createSession, markBrowserConnected, closeSession)
  }

  match /users/{uid}/sessions/{sessionId}/tasks/{taskId} {
    allow read: if request.auth.uid == uid;
    allow write: if false;  // Admin SDK only (writeTask, writeTaskResult, haltForAuth)
  }

  match /users/{uid}/sessions/{sessionId}/auth/{taskId} {
    allow read: if request.auth.uid == uid;
    // Auth doc created by Admin SDK (haltForAuth). Mobile updates approval decisions only.
    allow update: if request.auth.uid == uid
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['status', 'approvalToken', 'approvedAt']);
  }

  match /users/{uid}/devices/{deviceId} {
    allow read: if request.auth.uid == uid;
    allow write: if false;  // Admin SDK only (POST /agent/browser/register-device upsert)
  }

  }
}
```

Extension reads task docs for resume-after-approval (Phase 2) but never writes them. Task results written by the extension travel through the WS → Cloud Agent → Admin SDK path only.

---

## Task DSL

### Action Catalog

Seven primitive actions across three tiers:

| Tier | Actions | Auth Required |
|------|---------|---------------|
| `read_only` | `extract`, `summarize_visible_text`, `read_dom` | Never |
| `navigation` | `open_tab`, `focus_tab`, `scroll` | Never |
| `stateful` | `fill_field`, `click` | Context-dependent (Phase 2) |

### TaskIntent Envelope

```typescript
interface TaskIntent {
  version: "1";
  taskId: string;
  sessionId: string;
  requiresAuth: boolean;        // set by Cloud Coordinator; extension can only escalate
  actionSummary: string;        // human-readable; shown in approval card
  action: SingleAction | SequenceAction;
}

type SingleAction =
  | { type: "open_tab";               url: string }
  | { type: "focus_tab";              host: string }
  | { type: "extract";                selector: string; label?: string }
  | { type: "summarize_visible_text"; filter?: "no_nav" | "no_ads" | "all" }
  | { type: "read_dom";               selector: string }
  | { type: "scroll";                 direction: "up" | "down"; pixels?: number }
  | { type: "fill_field";             selector: string; value: string; tier: "stateful" }
  | { type: "click";                  selector: string; label?: string; tier: "stateful" }

interface SequenceAction {
  type: "sequence";
  steps: SingleAction[];        // no nested sequences
}
```

### Destructive Action Classifier (two-layer)

Both layers share a single regex constant in `shared/constants.ts` to prevent rule drift:

```typescript
// shared/constants.ts
export const DESTRUCTIVE_ACTION_PATTERN =
  /submit|delete|pay|confirm|send|checkout|transfer|remove|cancel subscription/i

export function classifyActionLabel(label: string | undefined | null): 'safe' | 'requires_auth' { /* ... */ }

/** Layer 1 — inspects actionSummary, step labels, and selectors. */
export function intentRequiresAuth(
  actionSummary: string,
  action: SingleAction | SequenceAction,
): boolean { /* ... */ }
```

**Layer 1 — Cloud Coordinator** (on intent generation): Sets `requiresAuth: true` if action label or selector matches `DESTRUCTIVE_ACTION_PATTERN`.

**Layer 2 — Extension local validator** (defense-in-depth, runs before execution): Inspects live DOM — button text, `form[action]`, ARIA role — against the same constant. Can escalate `requiresAuth` to `true`; can never downgrade it. Mitigates LLM misclassification of destructive elements.

```typescript
import { DESTRUCTIVE_ACTION_PATTERN } from '../../shared/constants'

function classifyElement(el: Element): "safe" | "requires_auth" {
  const text = (el.textContent ?? "").toLowerCase()
  if (DESTRUCTIVE_ACTION_PATTERN.test(text)) return "requires_auth"
  if (el.closest("form") && el.matches("[type=submit]")) return "requires_auth"
  return "safe"
}
```

### Sequence Halt Behavior

Sequences execute steps in order. On first step classified `requires_auth`:
- Extension halts (does not execute the step)
- Sends `awaiting_auth` frame via WS; Cloud Agent writes `{ status: "awaiting_auth", haltedStepIndex: i }` via Admin SDK
- Steps before the halt are already executed — no rollback (web state is not reversible)
- On re-wake after approval: extension reads `haltedStepIndex` from task doc (read-only), resumes from `steps[haltedStepIndex]`

### Example Payloads

**Read-only (auto-approve):**
```json
{
  "version": "1",
  "taskId": "f3a1...",
  "sessionId": "b2c9...",
  "requiresAuth": false,
  "actionSummary": "Summarize article text on current tab",
  "action": { "type": "summarize_visible_text", "filter": "no_nav" }
}
```

**Sequence (mixed tiers — halts at stateful step):**
```json
{
  "version": "1",
  "taskId": "a7d2...",
  "sessionId": "b2c9...",
  "requiresAuth": true,
  "actionSummary": "Open Amazon checkout and submit payment of $42.99",
  "action": {
    "type": "sequence",
    "steps": [
      { "type": "open_tab", "url": "https://www.amazon.com/checkout" },
      { "type": "extract", "selector": ".order-summary", "label": "order_total" },
      { "type": "click", "selector": "#submit-order-btn", "label": "Submit Payment", "tier": "stateful" }
    ]
  }
}
```

### Task Result Schema

```typescript
interface TaskResult {
  taskId: string;
  status: "complete" | "failed" | "aborted";
  data: Record<string, string>;   // keyed by `label` from extract steps
  activeUrl: string;
  error?: {
    code: "SELECTOR_NOT_FOUND" | "HOST_NOT_ALLOWED" | "HOST_PERMISSION_REQUIRED"
         | "EXTENSION_OFFLINE" | "AUTH_TIMEOUT" | "EXECUTION_ERROR" | "EXECUTION_TIMEOUT";
    message: string;
    failedAction: SingleAction;
  };
}
```

### Error Codes

| Code | Meaning | Phase |
|------|---------|-------|
| `HOST_PERMISSION_REQUIRED` | Target host not in `optional_host_permissions`; user must grant via side panel notification | 1 |
| `HOST_NOT_ALLOWED` | Cloud Coordinator blocklist rejects host (e.g. `chrome://`, `file://`, banking SSO domains) | 1 |
| `SELECTOR_NOT_FOUND` | DOM selector missed on live page | 1 |
| `EXTENSION_OFFLINE` | Durable wake timeout — no `browserConnectedAt` within 12s | 1 |
| `AUTH_TIMEOUT` | Destructive action approval expired (Phase 2) | 2 |
| `EXECUTION_ERROR` | Unclassified runtime failure in content script | 1 |
| `EXECUTION_TIMEOUT` | Extension connected but task did not reach terminal status within 30s (text path LB ceiling); extension connected and attempted so no refund | 1 |

`HOST_PERMISSION_REQUIRED` is recoverable (user grants, re-asks). `HOST_NOT_ALLOWED` is not — the coordinator refuses before FCM dispatch.

---

## Safety Tiers & Approval Flow (Phase 2)

### End-to-End Approval Flow

```
Extension halts at step i (destructive action detected)
  → sends { type: "awaiting_auth", taskId, haltedStepIndex } via WS
  → Cloud Agent (browser-side) calls haltForAuth() via Admin SDK:
      task doc: { status: "awaiting_auth", haltedStepIndex: i }
      auth doc: { status: "pending", actionSummary, expiresAt: +5min }

Cloud Coordinator (Firestore listener on task doc)
  → sees status = "awaiting_auth"
  → fires Expo Push approval card to mobile (see payload below)
  → if voice session active on same instance: speaks
      "I've paused. Check your screen to approve."

Mobile App
  → shows approval card (in-app or lock screen)
  → user taps Approve:
      background handler writes { status: "approved", approvalToken: <Firebase ID token> } to auth doc
      (opensAppToForeground: false — phone stays locked)
  → user taps Deny:
      writes { status: "denied" } to auth doc

Cloud Coordinator (Firestore listener on auth doc)
  → Approve path:
      verifies approvalToken via Firebase Admin SDK
      sends FCM WAKE_AND_CONNECT { taskId, resume: true } to extension
      extension wakes, reads task doc, resumes from haltedStepIndex
  → Deny / Timeout path:
      updates task doc { status: "aborted" }
      sends SESSION_END to extension (if WS still open)
      notifies voice/text session: "Action was denied."
```

### Expo Push Notification Payloads

**Approval card (actionable, lock-screen buttons):**
```json
{
  "to": "<expo-push-token>",
  "title": "Clanker needs your approval",
  "body": "Submit payment of $42.99 on amazon.com",
  "data": {
    "type": "PENDING_AUTH",
    "sessionId": "b2c9...",
    "taskId": "a7d2...",
    "actionSummary": "Submit payment of $42.99 on amazon.com"
  },
  "categoryIdentifier": "BROWSER_ACTION_APPROVAL",
  "priority": "high",
  "ttl": 300
}
```

Expo notification category registered at app startup:
```typescript
{
  identifier: "BROWSER_ACTION_APPROVAL",
  actions: [
    { identifier: "APPROVE", buttonTitle: "Approve", options: { opensAppToForeground: false } },
    { identifier: "DENY",    buttonTitle: "Deny",    options: { opensAppToForeground: false } }
  ]
}
```

**Async task complete (extension finished while phone was idle):**
```json
{
  "to": "<expo-push-token>",
  "title": "Clanker finished",
  "body": "Your document summary is ready.",
  "data": { "type": "TASK_COMPLETE", "sessionId": "...", "taskId": "...", "deepLink": "/talk" },
  "priority": "normal"
}
```

**Proactive (Cloud Scheduler triggered):**
```json
{
  "to": "<expo-push-token>",
  "title": "Clanker noticed something",
  "body": "That flight price dropped to $340. Tap to let me book it.",
  "data": { "type": "PROACTIVE_TASK", "sessionId": "...", "taskId": "...", "deepLink": "/talk" },
  "categoryIdentifier": "BROWSER_ACTION_APPROVAL",
  "priority": "high"
}
```

Voice authorization (LLM ASR interpretation) is explicitly excluded from the approval path. All destructive actions require a physical UI tap. Verbal "yes" during a live call is probabilistic — the tap provides **deterministic proof of identity**: the authenticated user's Firebase UID physically tapped the button, scoped strictly to the specific `auth/{taskId}` document path and the 5-minute TTL. The `approvalToken` proves who, not what — the auth doc's Firestore path and `actionSummary` field carry the action binding.

---

## Cloud Agent Changes

`browser_action` and bridge WebSocket routes are wired only when Firebase Admin is initialized (`admin.apps.length > 0`). Local/test runs without Admin omit the tool so handlers do not call `admin.firestore()` or `admin.messaging()`.

### New Files

```
cloud-agent/src/
  tools/
    browserAction.ts           # ADK FunctionTool — Wake-and-Connect pipeline + contextual billing
  handlers/
    wsBrowserAgentHandler.ts     # /agent/browser WS upgrade handler
  services/
    sessionBridge.ts             # in-memory session map per Cloud Run instance
    fcmDispatcher.ts             # FCM silent push + Expo Push REST
    firestoreSession.ts          # Firestore read/write helpers

shared/
  constants.ts                   # DESTRUCTIVE_ACTION_PATTERN (shared by cloud + extension)
```

### Billing

`browser_action` uses **contextual billing** to avoid double-charging on the text path:

| Path | Timer billing | `browser_action` flat billing |
|------|--------------|-------------------------------|
| Voice (`/agent/live`) | Timer-billed per wall-clock interval — **paused** during `browser_action`, resumed on return | `spendCredit(uid)` after `getActiveDevice` succeeds |
| Text (`POST /agent/run`) | 1 credit spent before ADK runs | Skip `spendCredit` — pass `{ preBilled: true }` into `browserActionTool` |

See "Credit billing (contextual)" in the Tool Invocation Flow section for the `pauseBilling()` / `resumeBilling()` contract. Refund on `EXTENSION_OFFLINE` or other pre-execution failures applies only when a credit was spent (voice path). No refund for execution errors — the extension connected and attempted the task. **No credit spent** when no active device is registered or when `isPaused: true` (see Device document).

### New HTTP Endpoint: `POST /agent/browser/register-device`

```typescript
// Request (behind existing requireAuth middleware)
{ fcmToken: string; deviceId: string; deviceName: string }

// Action: upsert users/{uid}/devices/{deviceId}
// Response: 200 { ok: true }
```

### New WebSocket Route: `/agent/browser`

Added to `attachWebSocketRoutes` in `index.ts` alongside `/agent/stream` and `/agent/live`.

### `wsBrowserAgentHandler.ts` Protocol

```typescript
// Auth frame — must arrive within 5 seconds or WS is closed 4001
const browserAuthSchema = z.object({
  type: z.literal('auth'),
  idToken: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
})

// After auth: verify token → validate deviceId in Firestore (active && !isPaused)
// → markBrowserConnected(uid, sessionId, INSTANCE_ID)  // Firestore + task status: executing
// → send session_ready
// → sessionBridge.registerBrowser(uid, sessionId, ws)  // same-instance shortcut only
// → read pending task via firestoreSession.getFirstTask(uid, sessionId)
// → dispatch pending task to extension via ws.send()
// → on result frame: writeTaskResult to Firestore (Admin SDK)
// → on WS close: sessionBridge.deregister(uid, sessionId)

// Extension → Cloud Agent frames:
{ type: "task_result",  taskId, data, activeUrl }
{ type: "task_error",   taskId, code, message, failedAction }
{ type: "awaiting_auth", taskId, haltedStepIndex }
{ type: "ping" }

// Cloud Agent → Extension frames:
{ type: "session_ready", sessionId }
{ type: "task", intent: TaskIntent }
{ type: "session_end" }
{ type: "pong" }          // response to ping (heartbeat)
{ type: "error", code, message }
```

### `sessionBridge.ts`

```typescript
interface SessionState {
  sessionId: string;
  voiceWs: WebSocket | null;   // same-instance shortcut only; may be null cross-instance
  browserWs: WebSocket | null;
  firestoreUnsub: (() => void) | null;
}
// Map key: `${uid}:${sessionId}`
// Module-level singleton — one map per Cloud Run instance

export function registerBrowser(uid: string, sessionId: string, ws: WebSocket): void
export function registerVoice(uid: string, sessionId: string, ws: WebSocket): void
export function getSession(uid: string, sessionId: string): SessionState | undefined
export function deregister(uid: string, sessionId: string): void
```

`wsLiveAgentHandler` calls `registerVoice` on auth as a same-instance shortcut. The primary result delivery path is always the voice-side `watchTask` Firestore listener — `voiceWs` is only used when both sockets land on the same instance.

### `fcmDispatcher.ts`

```typescript
// Silent push to extension via Firebase Admin SDK messaging().send()
export async function wakeExtension(fcmToken: string, sessionId: string, taskId: string, resume?: boolean): Promise<void>

// Expo Push via POST https://exp.host/--/api/v2/push/send (no SDK needed)
export async function sendApprovalCard(expoPushToken: string, sessionId: string, taskId: string, actionSummary: string): Promise<void>
export async function sendTaskComplete(expoPushToken: string, taskId: string, summary: string): Promise<void>
export async function sendProactive(expoPushToken: string, sessionId: string, taskId: string, body: string): Promise<void>
```

### `firestoreSession.ts`

```typescript
export async function getActiveDevice(uid: string): Promise<DeviceDoc | null>
export async function createSession(uid: string, sessionId: string, meta: SessionMeta): Promise<void>
export async function markBrowserConnected(uid: string, sessionId: string, browserInstanceId: string): Promise<void>
export async function closeSession(uid: string, sessionId: string, status: 'closed' | 'aborted'): Promise<void>
export async function getSession(uid: string, sessionId: string): Promise<SessionDoc>
export async function getTask(uid: string, sessionId: string, taskId: string): Promise<TaskDoc>
export async function writeTask(uid: string, sessionId: string, taskId: string, task: TaskIntent): Promise<void>
export async function haltForAuth(uid: string, sessionId: string, taskId: string, haltedStepIndex: number, actionSummary: string): Promise<void>
export async function writeTaskResult(uid: string, sessionId: string, taskId: string, result: TaskResult): Promise<void>
export function watchTask(uid: string, sessionId: string, taskId: string, cb: (task: TaskDoc) => void): () => void
export function watchAuth(uid: string, sessionId: string, taskId: string, cb: (auth: AuthDoc) => void): () => void
```

All write helpers use the Firebase Admin SDK and bypass client security rules.

---

## MV3 Extension Structure

### Directory Layout

```
extension/
  manifest.json
  background/
    service-worker.ts      # FCM receiver, WS lifecycle, task dispatch
    auth-bridge.ts         # SW-side: ensureOffscreen() + requestIdToken()
    ws-client.ts           # WebSocket wrapper (auth frame + teardown)
    task-dispatcher.ts     # Parses TaskIntent, routes to content script
    content-bridge.ts      # chrome.runtime message relay
  offscreen/
    auth.html              # Hidden document host for Firebase Auth SDK
    auth.ts                # getIdToken() via browserLocalPersistence
  content/
    executor.ts            # DSL action runners injected into page
    safety-classifier.ts   # Local destructive pattern classifier
    dom-extractor.ts       # extract / summarize_visible_text / read_dom
  ui/
    side-panel/
      index.html
      panel.ts             # signInWithPopup, device status, action log, Pause switch
    popup/
      index.html           # Status badge + link to side panel
  shared/
    dsl-types.ts           # TaskIntent, TaskResult (mirrors cloud-agent types)
    constants.ts
  icons/
    icon-16.png  icon-48.png  icon-128.png
```

### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Clanker Desktop Bridge",
  "version": "0.1.0",
  "description": "Lets your Clanker agent perform web tasks you request on this browser.",

  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },

  "content_scripts": [],

  "permissions": [
    "scripting",
    "storage",
    "sidePanel",
    "notifications",
    "gcm",
    "offscreen"
  ],

  "optional_host_permissions": ["<all_urls>"],

  "side_panel": { "default_path": "ui/side-panel/index.html" },

  "action": {
    "default_popup": "ui/popup/index.html",
    "default_icon": { "16": "icons/icon-16.png", "48": "icons/icon-48.png" }
  },

  "key": "<public key for consistent extension ID>"
}
```

**Manifest key note:** The `key` field holds the extension's _public_ key and is safe to commit. The corresponding private `.pem` file (used to sign the extension and maintain a stable CWS extension ID) must never be committed to version control — store in 1Password or equivalent.

`content_scripts` is empty — scripts injected programmatically via `chrome.scripting.executeScript` only during active tasks. Extension never touches DOM between tasks.

`optional_host_permissions` — Chrome prompts user per-host on first task targeting a new site. Avoids broad-permission rejection from CWS review. `activeTab` is intentionally omitted — it requires a user gesture (e.g. clicking the extension icon) and is unavailable during FCM background wake; `scripting` + granted `optional_host_permissions` cover programmatic injection.

`gcm` — required for `chrome.gcm.register()` / `chrome.gcm.onMessage` (FCM wake). `offscreen` — required for `chrome.offscreen.createDocument()` (Firebase Auth SDK host).

### Firebase Auth via Offscreen Document

The standard Firebase Web SDK requires DOM APIs (`IndexedDB` for `browserLocalPersistence`, hidden iframes for auth state) that are unavailable in MV3 service workers. Google's canonical pattern: host the Firebase Auth SDK in an **offscreen document**, orchestrated by the service worker.

**No refresh tokens in `chrome.storage.local`.** Persistence lives in the offscreen document's IndexedDB via `browserLocalPersistence`. Token shape matches mobile app and Cloud Agent (`admin.auth().verifyIdToken`).

```
Side Panel (one-time login):
  1. User opens side panel, signs in via signInWithPopup (Firebase Web SDK)
  2. Auth state persists in offscreen doc's IndexedDB (shared extension origin)
  3. Side panel writes deviceId (generated UUID) to chrome.storage.local

Service Worker (every wake):
  1. auth-bridge.ensureOffscreen()
       → chrome.offscreen.hasDocument() ? skip
       → chrome.offscreen.createDocument({
            url: 'offscreen/auth.html',
            reasons: ['DOM_PARSER'],
            justification: 'Required to host Firebase Web Auth SDK which relies on DOM storage APIs',
          })
  2. auth-bridge.requestIdToken()
       → chrome.runtime.sendMessage({ target: 'offscreen-auth', type: 'GET_ID_TOKEN' })
       → Offscreen auth.ts: getAuth().currentUser.getIdToken(false) → reply
  3. Uses idToken in WS auth frame
  4. On SESSION_END or idle: chrome.offscreen.closeDocument()
```

`auth-bridge.ts` (service worker):

```typescript
export async function ensureOffscreen(): Promise<void> { /* createDocument if absent */ }
export async function requestIdToken(): Promise<string> { /* message offscreen doc */ }
export async function closeOffscreen(): Promise<void> { /* closeDocument after session */ }
```

`offscreen/auth.ts`:

```typescript
// Listens for { target: 'offscreen-auth', type: 'GET_ID_TOKEN' }
// Returns fresh idToken via getAuth(firebaseApp).currentUser?.getIdToken(false)
// Throws if not signed in → SW surfaces "Sign in via side panel" error
```

`FIREBASE_API_KEY` is safe to embed in the extension bundle — it is a public identifier, not a secret. Firebase Security Rules enforce actual access control. App Check on extension REST calls is a Phase 2 hardening item.

Extension `env.ts` values are injected at build time by `extension/esbuild.mjs` from repo-root `.env` / `.env.development.local` (`EXPO_PUBLIC_FIREBASE_*`, `EXPO_PUBLIC_CLOUD_AGENT_URL`), matching the mobile app. Unset vars fall back to `REPLACE_*` placeholders for unpacked dev loads before the first configured build.

### Chrome GCM Push Registration

Standard `firebase/messaging` SDK requires a web origin and a `firebase-messaging-sw.js` file — neither available in an MV3 extension. Use Chrome's native `chrome.gcm` API instead. Firebase Admin SDK is fully backwards-compatible with GCM registration tokens.

```
On install:
  chrome.gcm.register([FIREBASE_SENDER_ID], (registrationToken) => {
    // registrationToken is a GCM token — Admin SDK messaging().send() accepts it natively
    chrome.storage.local.set({ gcmToken: registrationToken })
    // POST /agent/browser/register-device with { fcmToken: registrationToken, deviceId, deviceName }
  })

On incoming GCM message (replaces FCM push listener):
  chrome.gcm.onMessage.addListener((message) => {
    if (message.data.type === 'WAKE_AND_CONNECT') {
      // begin ws-client.connect() flow
    }
  })
```

The `fcmToken` field in `users/{uid}/devices/{deviceId}` stores a GCM registration token. No rename needed — Firebase Admin SDK treats them identically.

### Service Worker Responsibilities

```
On install:
  → chrome.gcm.register([FIREBASE_SENDER_ID]) → store gcmToken
  → Generate deviceId (UUID) → store in chrome.storage.local
  → POST /agent/browser/register-device { fcmToken: gcmToken, deviceId, deviceName }

On GCM WAKE_AND_CONNECT message:
  → auth-bridge.ensureOffscreen()
  → idToken = auth-bridge.requestIdToken()
  → ws-client.connect(sessionId, idToken, deviceId)
  → On session_ready: POST /agent/browser/register-device (refreshes lastSeenAt)
  → On session_ready: task-dispatcher.dispatch(task)
  → ws-client starts internal setInterval ping loop (every 20s while WS open)
  → If no pong within 5s: ws-client.reconnect()

On WS SESSION_END:
  → ws-client.close()  // clears ping interval
  → auth-bridge.closeOffscreen()
  → Service worker suspends
```

Service worker never touches DOM. All DOM work is in content scripts injected per-task. Sign-out in side panel calls Firebase `signOut()` in the offscreen doc and clears `deviceId` from storage.

**WS heartbeat:** Do not use `chrome.alarms` for heartbeat — Chrome enforces a 30s minimum period on persisted alarms in some contexts. Instead, `ws-client.ts` maintains an internal `setInterval` ping loop while the WebSocket is open; Chromium allows this as long as the socket remains active.

### Host Permission Grant Flow

`chrome.permissions.request()` requires a user gesture — cannot be called from service worker background context.

```
1. Service worker receives intent for new host
2. chrome.permissions.contains({ origins: ["https://amazon.com/*"] })
3. If false:
     chrome.notifications.create("Clanker needs access to amazon.com. Click to grant.")
     return HOST_PERMISSION_REQUIRED error to Cloud Agent
     Cloud Agent voices: "I need permission to access that site on your browser.
                         Click the notification on your screen to allow it."
4. User clicks notification → side panel opens with [Grant Access] button
5. User clicks [Grant Access] (user gesture) → chrome.permissions.request() fires
6. On grant: user re-asks Clanker (MVP) or pending task auto-retries (Phase 2)
```

### Content Script ↔ Service Worker Protocol

```typescript
// service-worker → content script (via chrome.scripting.executeScript)
{ type: "EXECUTE_ACTION", action: SingleAction, taskId: string }

// content script → service-worker (via chrome.runtime.sendMessage)
{ type: "ACTION_RESULT",  taskId: string; data: Record<string, string>; activeUrl: string }
{ type: "ACTION_ERROR",   taskId: string; code: string; message: string; failedAction: SingleAction }
{ type: "AWAITING_AUTH",  taskId: string; haltedStepIndex: number; actionSummary: string }
```

### Side Panel UI

```
┌─────────────────────────────────┐
│ Clanker Desktop Bridge          │
│                                 │
│ Status: ● Connected / ○ Idle    │
│ Account: user@example.com       │
│ Device:  Home Mac — Chrome      │
│                                 │
│ Recent Actions                  │
│ ─────────────────────────────── │
│ 14:32  extract  amazon.com  ✓   │
│ 14:30  open_tab google.com  ✓   │
│ 14:28  click    form submit  ⏸  │
│                                 │
│ [Pause Remote Actions] [Sign Out]│
└─────────────────────────────────┘
```

Action log: last 50 entries in `chrome.storage.local`. "Pause Remote Actions" writes `{ paused: true }` — service worker checks before processing any task.

---

## MVP Scope & Phasing

### Phase 1 — MVP (Read-Only Bridge)

**In scope:**
- Device pairing: Firebase Auth + FCM token registration (`/agent/browser/register-device`)
- Wake-and-Connect lifecycle: FCM → WS auth → task dispatch → SESSION_END
- Task DSL read-only + navigation tiers: `extract`, `summarize_visible_text`, `read_dom`, `open_tab`, `focus_tab`, `scroll`
- Context streaming: extension → Firestore → Cloud Agent → voice/text response
- Fail-closed error handling: `SELECTOR_NOT_FOUND`, `HOST_NOT_ALLOWED`, `EXTENSION_OFFLINE`, `HOST_PERMISSION_REQUIRED`
- Wake Timeout (12s offline detection)
- Side panel: auth, status badge, action log, Pause kill switch
- Host permission grant flow (notification + side panel button)

**Out of scope (Phase 2+):**
- Stateful actions: `fill_field`, `click`
- FCM approval card + Expo Push pipeline
- `haltedStepIndex` sequence resume
- Proactive / Cloud Scheduler triggered tasks
- Multi-device pairing
- Auto-retry after host permission grant

**Phase 1 gate:** 5 real-world `extract` + `summarize_visible_text` tasks complete end-to-end.

### Phasing

| Phase | Scope | Gate |
|-------|-------|------|
| 1 | Read-only + navigation bridge: pairing, WS, all 6 Phase 1 actions, billing, error handling | 5 E2E extract/summarize tasks pass |
| 2 | Stateful actions: fill_field, click, FCM approval card, haltedStepIndex resume | Approval flow validated on staging payment form |
| 3 | Proactive: Cloud Scheduler triggers, Expo Push async completion | 1 working scheduled monitoring task |
| 4 | CWS submission | Policy preflight checklist passes, store listing approved |

---

## Test Strategy

### Unit — Cloud Agent

- `wsBrowserAgentHandler`: auth timeout, invalid deviceId rejection, task dispatch, SESSION_END teardown, markBrowserConnected
- `browserActionTool`: contextual billing (voice spends, text skips), device-not-found no-credit path, sync `await watchTask` on text path
- `sessionBridge`: register/deregister, voice+browser co-registration, same-instance shortcut only
- `fcmDispatcher`: FCM payload shape, Expo Push REST call (mock fetch)
- `firestoreSession`: durable wake timeout (Firestore query, not sessionBridge), getActiveDevice no-credit path, read/write helpers (mock Firestore Admin SDK)
- Task DSL schema validator: valid/invalid intents, tier classification

### Unit — Extension

- `auth-bridge`: ensureOffscreen, requestIdToken, closeOffscreen (offscreen doc mock)
- `safety-classifier`: destructive pattern matching against fixture elements
- `dom-extractor`: `extract`, `summarize_visible_text`, `read_dom` against fixture HTML
- `task-dispatcher`: action type routing, sequence step iteration, halt at stateful step
- `content-bridge`: message relay (chrome mock)

### Integration

- FCM token registration → device doc written to Firestore
- Full Wake-and-Connect: FCM push → WS auth → task dispatch → result return → SESSION_END
- Host permission check → local notification → side panel grant flow
- Wake Timeout: extension never connects → durable Firestore check → `EXTENSION_OFFLINE` + credit refund
- No registered device: tool handler returns error without `spendCredit`

### E2E (manual, Phase 1 gate)

- Voice: "What does the article say?" → extension summarizes active tab → voice reads summary
- Text: "Extract the price from my open tab" → extract result returned to chat
- Browser closed: voice receives "Your browser extension appears to be offline."
- Host not granted: desktop notification + side panel grant → user re-asks → task succeeds

### Policy Preflight (before CWS submission)

- No remote executable code paths (verify `manifest.json` CSP, no `eval`)
- Permission justification documented for every `manifest.json` entry (including `gcm`, `offscreen`; `activeTab` and `alarms` intentionally omitted)
- Privacy disclosures match runtime behavior
- `optional_host_permissions` grant flow reviewable by Chrome team
- `content_scripts: []` confirmed empty — no declarative DOM access

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Wake timeout false positive across Cloud Run instances | Medium | Durable timeout queries Firestore `browserConnectedAt` / task `executing` — never local `sessionBridge` |
| CWS rejection for "general browser control" | Medium | Narrow store listing; tight single-purpose description; optional host permissions; empty declarative content_scripts |
| FCM silent push deprioritized by OS battery saver | Medium | Document limitation; fallback: user opens extension popup to manually check pending tasks |
| Selector brittleness on SPAs / React apps | High | Phase 2 site adapters; voice-guided correction flow; `SELECTOR_NOT_FOUND` surfaces clearly via voice |
| Firestore listener scaling on Cloud Run | Low | Listeners are per-session; torn down on SESSION_END; Firestore TTL cleans orphans; monitor in Cloud Monitoring |
| Service worker suspension mid-sequence during auth pause | Low | `haltedStepIndex` persisted to Firestore before halt; resume on re-wake (Phase 2) |
| `chrome.gcm` legacy API deprecation | Low | Chrome deprecated `chrome.gcm` in favor of VAPID Web Push; no removal date announced but monitor Chrome deprecation notices; prepare to migrate if MV3 gains stable push support without offscreen workarounds |
| Cloud Run instance scale-down mid wake-timeout | Low | Voice-side `setTimeout` lives on accepting instance; if instance terminates before 12s, timeout never fires; acceptable backstop — Firestore +30min TTL cleans orphaned task and session docs |

---

## Open Questions (Deferred)

1. Phase 2: should task auto-retry after host permission grant, or require user to re-ask?
2. Phase 3: Cloud Scheduler task format — same TaskIntent DSL, or new envelope?
3. Phase 4: CWS listing — single-purpose "Clanker" listing, or separate developer extension?

**Resolved (2026-06-29):** Extension Firebase Auth uses offscreen document + `browserLocalPersistence` (not `stsTokenManager` / Secure Token REST). `browser_action` is implemented as an ADK `FunctionTool` in `cloud-agent/src/tools/browserAction.ts` — not in `agent-tools-spec.ts`. Text path (`/agent/run`) blocks synchronously on `watchTask`; voice path uses async listener + interim response. Contextual billing prevents double-charge on text turns. `INSTANCE_ID` (per-container UUID) replaces `K_REVISION` for instance tracking.
