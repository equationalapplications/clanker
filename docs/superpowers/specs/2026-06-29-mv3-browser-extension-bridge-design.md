# MV3 Browser Extension Remote Agent Bridge — Design Spec

**Date:** 2026-06-29
**Supersedes:** `2026-04-24-browser-extension-remote-agent-design.md` (April draft — replaced by this spec)

---

## Overview

Goal: let Clanker (mobile voice or text) instruct a trusted MV3 browser extension on the user's desktop to perform browser tasks — reading pages, extracting data, navigating, and (Phase 2+) submitting forms — within the user's existing authenticated sessions.

Core value: cross-device agent execution, not a generic automation platform.

CWS single-purpose statement:
> "Clanker companion extension that lets your Clanker agent perform web tasks you explicitly request on this browser."

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
  PENDING ──(extension WS connects)──► ROUTING
  ROUTING ──(task complete / session end)──► CLOSED
  ROUTING ──(destructive action — Phase 2)──► PENDING_AUTH
  PENDING_AUTH ──(FCM approval tap)──► ROUTING
  PENDING_AUTH ──(deny / 5min timeout)──► ABORTED
```

### Message Flow (happy path)

```
1.  [Mobile/Scheduler] user intent arrives at Cloud Agent
2.  [Cloud Agent] writes TaskIntent to Firestore task doc
3.  [Cloud Agent] sends FCM silent push to extension FCM token:
      { type: "WAKE_AND_CONNECT", sessionId, taskId }
4.  [Cloud Agent] starts 12-second wake timeout
5.  [MV3 service worker] wakes, connects WebSocket to /agent/browser
6.  [Extension → Cloud Agent] auth frame:
      { type: "auth", idToken, sessionId, deviceId }
7.  [Cloud Agent] verifies token + validates deviceId in Firestore devices collection
8.  [Cloud Agent → Extension] { type: "session_ready", sessionId }
9.  [Cloud Agent] cancels wake timeout; registers browserWs in sessionBridge
10. [Cloud Agent] reads pending task from Firestore, sends to extension via WS
11. [Extension] executes Task DSL, returns result via WS
12. [Cloud Agent] writes result to Firestore; routes to voice socket or Expo Push
13. [Cloud Agent → Extension] { type: "session_end" }
14. [Extension] closes WS; service worker suspends
```

### Wake Timeout

If extension WS does not authenticate within 12 seconds of FCM dispatch:

```typescript
setTimeout(async () => {
  const session = sessionBridge.getSession(uid, sessionId)
  if (!session?.browserWs) {
    await firestoreSession.writeTaskResult(uid, sessionId, taskId, {
      status: 'failed',
      error: { code: 'EXTENSION_OFFLINE', message: 'Browser extension did not connect', failedAction: intent.action }
    })
    session?.voiceWs?.send(JSON.stringify({
      type: 'tool_end',
      result: 'Your browser extension appears to be offline.'
    }))
    sessionBridge.deregister(uid, sessionId)
  }
}, 12_000)
```

---

## Firestore Session Schema

All docs scoped under `users/{uid}/` for tenant isolation. Firebase Security Rules enforce `request.auth.uid == uid`. Cloud Agent service account bypasses via Admin SDK.

### Session document — `users/{uid}/sessions/{sessionId}`

```json
{
  "status": "routing | pending_auth | closed | aborted",
  "trigger": "voice | text | scheduler",
  "voiceInstanceId": "cloud-run-instance-abc",
  "browserInstanceId": "cloud-run-instance-xyz",
  "createdAt": "<timestamp>",
  "expiresAt": "<timestamp +30min>"
}
```

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
  "active": true
}
```

### Security Rules (sketch)

```
match /users/{uid}/sessions/{sessionId}/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
match /users/{uid}/devices/{deviceId} {
  allow read, write: if request.auth.uid == uid;
}
```

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

**Layer 1 — Cloud Coordinator** (on intent generation): Sets `requiresAuth: true` if action label or selector matches `/submit|delete|pay|confirm|send|checkout|transfer/`.

**Layer 2 — Extension local validator** (defense-in-depth, runs before execution): Inspects live DOM — button text, `form[action]`, ARIA role — against same pattern list. Can escalate `requiresAuth` to `true`; can never downgrade it. Mitigates LLM misclassification of destructive elements.

```typescript
function classifyElement(el: Element): "safe" | "requires_auth" {
  const text = (el.textContent ?? "").toLowerCase()
  const destructivePatterns = /submit|delete|pay|confirm|send|checkout|transfer|remove|cancel subscription/
  if (destructivePatterns.test(text)) return "requires_auth"
  if (el.closest("form") && el.matches("[type=submit]")) return "requires_auth"
  return "safe"
}
```

### Sequence Halt Behavior

Sequences execute steps in order. On first step classified `requires_auth`:
- Extension halts (does not execute the step)
- Writes `{ status: "awaiting_auth", haltedStepIndex: i }` to task doc
- Steps before the halt are already executed — no rollback (web state is not reversible)
- On re-wake after approval: extension reads `haltedStepIndex`, resumes from `steps[haltedStepIndex]`

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
         | "EXTENSION_OFFLINE" | "AUTH_TIMEOUT" | "EXECUTION_ERROR";
    message: string;
    failedAction: SingleAction;
  };
}
```

---

## Safety Tiers & Approval Flow (Phase 2)

### End-to-End Approval Flow

```
Extension halts at step i (destructive action detected)
  → writes { status: "awaiting_auth", haltedStepIndex: i } to task doc
  → writes { status: "pending", actionSummary, expiresAt: +5min } to auth doc

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

Voice authorization (LLM ASR interpretation) is explicitly excluded from the approval path. All destructive actions require a physical UI tap. Verbal "yes" during a live call is probabilistic — the tap provides deterministic, auditable, cryptographic proof of intent.

---

## Cloud Agent Changes

### New Files

```
cloud-agent/src/
  handlers/
    wsBrowserAgentHandler.ts     # /agent/browser WS upgrade handler
  services/
    sessionBridge.ts             # in-memory session map per Cloud Run instance
    fcmDispatcher.ts             # FCM silent push + Expo Push REST
    firestoreSession.ts          # Firestore read/write helpers
```

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

// After auth: verify token → validate deviceId in Firestore → send session_ready
// → sessionBridge.registerBrowser(uid, sessionId, ws)
// → start Firestore task listener
// → dispatch incoming tasks to extension via ws.send()
// → on result frame: write to Firestore, route to voiceWs or Expo Push
// → on WS close: sessionBridge.deregister(uid, sessionId), tear down listener

// Extension → Cloud Agent frames:
{ type: "task_result",  taskId, data, activeUrl }
{ type: "task_error",   taskId, code, message, failedAction }
{ type: "awaiting_auth", taskId, haltedStepIndex }
{ type: "ping" }

// Cloud Agent → Extension frames:
{ type: "session_ready", sessionId }
{ type: "task", intent: TaskIntent }
{ type: "session_end" }
{ type: "error", code, message }
```

### `sessionBridge.ts`

```typescript
interface SessionState {
  sessionId: string;
  voiceWs: WebSocket | null;
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

`wsLiveAgentHandler` calls `registerVoice` on auth so browser task results can be routed back to an active voice session on the same instance.

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
export async function writeTask(uid: string, sessionId: string, task: TaskIntent): Promise<void>
export async function haltForAuth(uid: string, sessionId: string, taskId: string, haltedStepIndex: number, actionSummary: string): Promise<void>
export async function writeTaskResult(uid: string, sessionId: string, taskId: string, result: TaskResult): Promise<void>
export function watchTasks(uid: string, sessionId: string, cb: (task: TaskDoc) => void): () => void
export function watchAuth(uid: string, sessionId: string, taskId: string, cb: (auth: AuthDoc) => void): () => void
```

---

## MV3 Extension Structure

### Directory Layout

```
extension/
  manifest.json
  background/
    service-worker.ts      # FCM receiver, WS lifecycle, task dispatch
    ws-client.ts           # WebSocket wrapper (auth frame + teardown)
    task-dispatcher.ts     # Parses TaskIntent, routes to content script
    content-bridge.ts      # chrome.runtime message relay
  content/
    executor.ts            # DSL action runners injected into page
    safety-classifier.ts   # Local destructive pattern classifier
    dom-extractor.ts       # extract / summarize_visible_text / read_dom
  ui/
    side-panel/
      index.html
      panel.ts             # Auth, device status, action log, Pause switch
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
    "activeTab",
    "scripting",
    "storage",
    "sidePanel",
    "notifications",
    "alarms"
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

`content_scripts` is empty — scripts injected programmatically via `chrome.scripting.executeScript` only during active tasks. Extension never touches DOM between tasks.

`optional_host_permissions` — Chrome prompts user per-host on first task targeting a new site. Avoids broad-permission rejection from CWS review.

### Service Worker Responsibilities

```
On install/startup:
  → Load deviceId + credentials from chrome.storage.local
  → Register Web Push (FCM) subscription
  → POST /agent/browser/register-device if fcmToken changed

On FCM WAKE_AND_CONNECT push:
  → ws-client.connect(sessionId)
  → On session_ready: fetch pending task from Firestore (via fetch + Firebase ID token)
  → task-dispatcher.dispatch(task)

On chrome.alarms (heartbeat while WS active, every 20s):
  → ws-client.ping()
  → If no pong within 5s: ws-client.reconnect()

On WS SESSION_END:
  → ws-client.close()
  → Service worker suspends
```

Service worker never touches DOM. All DOM work is in content scripts injected per-task.

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
- Task DSL read-only tier: `extract`, `summarize_visible_text`, `open_tab`, `scroll`
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
| 1 | Read-only bridge: pairing, WS, extract/summarize, error handling | 5 E2E extract tasks pass |
| 2 | Stateful actions: fill_field, click, FCM approval card, haltedStepIndex resume | Approval flow validated on staging payment form |
| 3 | Proactive: Cloud Scheduler triggers, Expo Push async completion | 1 working scheduled monitoring task |
| 4 | CWS submission | Policy preflight checklist passes, store listing approved |

---

## Test Strategy

### Unit — Cloud Agent

- `wsBrowserAgentHandler`: auth timeout, invalid deviceId rejection, task dispatch, SESSION_END teardown, wake timeout path
- `sessionBridge`: register/deregister, voice+browser co-registration, cross-socket routing
- `fcmDispatcher`: FCM payload shape, Expo Push REST call (mock fetch)
- `firestoreSession`: read/write helpers (mock Firestore Admin SDK)
- Task DSL schema validator: valid/invalid intents, tier classification

### Unit — Extension

- `safety-classifier`: destructive pattern matching against fixture elements
- `dom-extractor`: `extract`, `summarize_visible_text`, `read_dom` against fixture HTML
- `task-dispatcher`: action type routing, sequence step iteration, halt at stateful step
- `content-bridge`: message relay (chrome mock)

### Integration

- FCM token registration → device doc written to Firestore
- Full Wake-and-Connect: FCM push → WS auth → task dispatch → result return → SESSION_END
- Host permission check → local notification → side panel grant flow
- Wake Timeout: extension never connects → `EXTENSION_OFFLINE` result + voice error routing

### E2E (manual, Phase 1 gate)

- Voice: "What does the article say?" → extension summarizes active tab → voice reads summary
- Text: "Extract the price from my open tab" → extract result returned to chat
- Browser closed: voice receives "Your browser extension appears to be offline."
- Host not granted: desktop notification + side panel grant → user re-asks → task succeeds

### Policy Preflight (before CWS submission)

- No remote executable code paths (verify `manifest.json` CSP, no `eval`)
- Permission justification documented for every `manifest.json` entry
- Privacy disclosures match runtime behavior
- `optional_host_permissions` grant flow reviewable by Chrome team
- `content_scripts: []` confirmed empty — no declarative DOM access

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| CWS rejection for "general browser control" | Medium | Narrow store listing; tight single-purpose description; optional host permissions; empty declarative content_scripts |
| FCM silent push deprioritized by OS battery saver | Medium | Document limitation; fallback: user opens extension popup to manually check pending tasks |
| Selector brittleness on SPAs / React apps | High | Phase 2 site adapters; voice-guided correction flow; `SELECTOR_NOT_FOUND` surfaces clearly via voice |
| Firestore listener scaling on Cloud Run | Low | Listeners are per-session; torn down on SESSION_END; Firestore TTL cleans orphans; monitor in Cloud Monitoring |
| Service worker suspension mid-sequence during auth pause | Low | `haltedStepIndex` persisted to Firestore before halt; resume on re-wake (Phase 2) |

---

## Open Questions (Deferred)

1. Phase 2: should task auto-retry after host permission grant, or require user to re-ask?
2. Phase 3: Cloud Scheduler task format — same TaskIntent DSL, or new envelope?
3. Phase 4: CWS listing — single-purpose "Clanker" listing, or separate developer extension?
