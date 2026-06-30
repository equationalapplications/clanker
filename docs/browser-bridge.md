# Browser Bridge (Desktop Extension)

## Overview

The **Clanker Desktop Bridge** is an MV3 Chrome extension that lets your Clanker agent perform web tasks on your desktop browser when you explicitly request them — reading pages, extracting data, navigating, and (with approval) stateful actions like form fills and clicks.

Cross-device flow: you speak or type on mobile (or escalate text chat to Cloud Agent); Cloud Agent wakes the extension via FCM; the extension executes a Task DSL in your authenticated browser sessions and returns results through Firestore.

The edge agent and Firebase `generateReply` path **cannot** invoke `browser_action`. Only Cloud Agent (`/agent/live` voice or `/agent/run` text) has the tool, Firestore coordination, and FCM dispatch.

For C4 architecture diagrams, see [Architecture Charts — C4](flowcharts/c4/system-context.md#browser-bridge-routing-desktop-bridge-extension).

---

## Three-Node Architecture

| Node | Role | Connection |
|------|------|------------|
| Mobile app | Voice/text I/O, approval UI, Expo Push receiver | `/agent/live` or `/agent/run` |
| Cloud Agent | Session router, Firestore writer, FCM dispatcher | Per-instance `sessionBridge` (same-instance shortcut only) |
| Desktop Bridge extension | DOM executor | Idle (FCM) → active (`/agent/browser` WebSocket) |

**Key invariant:** Cloud Run instances never communicate directly. All cross-instance routing flows through Firestore (`users/{uid}/sessions/{sessionId}/tasks/{taskId}`). Voice and browser WebSockets may land on different instances; the voice-side `watchTask` listener is the primary result-delivery path.

---

## Triggering Tasks: `browser_action`

Gemini invokes the `browser_action` ADK tool (`cloud-agent/src/tools/browserAction.ts`) with an `actionSummary` and Task DSL `intent`. The tool handler:

1. Resolves a paired, non-paused device (`getActiveDevice`) — **no credit spent** if none found
2. Creates `sessionId` + `taskId`, writes session/task docs to Firestore
3. Dispatches FCM `WAKE_AND_CONNECT` to the extension
4. Delivers results:
   - **Voice:** interim tool response immediately; final result pushed into Gemini Live via `pushToLive`
   - **Text:** `await`s `watchTask` with a 30s cap (GCP load balancer ceiling)

Wiring:

| Entry point | Injection site |
|-------------|----------------|
| Voice (`/agent/live`) | `buildLiveTools` in `liveToolAdapter.ts` |
| Text (`/agent/run`) | `buildAgent` in `agentCore.ts` |

Bridge routes are registered only when Firebase Admin is initialized (`admin.apps.length > 0`).

---

## Wake-and-Connect Lifecycle

```
FCM WAKE_AND_CONNECT
  → extension service worker wakes
  → offscreen Firebase Auth → idToken
  → WebSocket /agent/browser auth frame { sessionId, deviceId, idToken }
  → Cloud Agent markBrowserConnected → session_ready
  → Task DSL dispatched to content scripts (chrome.scripting.executeScript)
  → task_result via WS → Firestore → voice/text response
  → session_end → extension suspends
```

**Wake timeout (12s):** If the extension does not connect, Cloud Agent writes `EXTENSION_OFFLINE` to Firestore (queries durable state, never local `sessionBridge`). Voice path refunds the `browser_action` credit.

**Auth frame timeout (5s):** Browser-side handler closes the socket with code 4001 if no auth frame arrives.

---

## Task DSL (summary)

| Tier | Actions |
|------|---------|
| Read + navigation | `extract`, `summarize_visible_text`, `read_dom`, `open_tab`, `focus_tab`, `scroll` |
| Stateful (approval-gated) | `fill_field`, `click` |

Destructive actions use a two-layer classifier sharing `DESTRUCTIVE_ACTION_PATTERN` in `shared/constants.ts`:

1. **Cloud Coordinator** — sets `requiresAuth` on intent generation
2. **Extension** — Layer 2 DOM classifier can escalate; never downgrade

On halt: extension sends `awaiting_auth` → Cloud Agent writes auth doc → Expo Push approval card → mobile approves via `POST /agent/browser/approve-action` → FCM re-wake with resume from `haltedStepIndex`.

Canonical types: `shared/dsl-types.ts` (mirrored in `extension/src/shared/dsl-types.ts`).

---

## Device Pairing

1. User signs in via extension side panel (Firebase Auth via offscreen document)
2. On install: `chrome.gcm.register` → store token → `POST /agent/browser/register-device`
3. Cloud Agent upserts `users/{uid}/devices/{deviceId}` with `fcmToken`, `deviceName`, `lastSeenAt`
4. Extension re-POSTs on `session_ready` to refresh `lastSeenAt`

**Pause kill switch:** Side panel writes `isPaused: true` via register-device upsert. Paused devices are excluded from `getActiveDevice` — tool returns an error without spending credits.

**Host permissions:** Extension uses `optional_host_permissions: ["<all_urls>"]`. First task on a new host triggers a notification → side panel grant button (`chrome.permissions.request` requires user gesture).

---

## HTTP / WebSocket Endpoints

| Route | Purpose |
|-------|---------|
| `POST /agent/browser/register-device` | Upsert device doc (fcmToken, deviceId, deviceName, isPaused) |
| `POST /agent/browser/approve-action` | Mobile approval/denial for destructive actions |
| `POST /agent/user/expo-push-token` | Register Expo push token for approval cards |
| `POST /agent/browser/scheduler-trigger` | Cloud Scheduler proactive tasks (Phase 2+) |
| WebSocket `/agent/browser` | Extension auth frame, task dispatch, results |

---

## Billing

`browser_action` uses **contextual billing** to avoid double-charging:

| Path | Timer billing | `browser_action` flat billing |
|------|--------------|-------------------------------|
| Voice (`/agent/live`) | Wall-clock timer **paused** during wake + execution | `spendCredit` after device found |
| Text (`/agent/run`) | N/A (1 credit pre-spent per turn) | Skip `spendCredit` (`preBilled: true`) |

Refunds apply on `EXTENSION_OFFLINE` (voice path only, when a credit was spent). No refund on execution errors — the extension connected and attempted the task.

See [Billing & Credits](billing-and-credits.md#browser-action-billing) for details.

---

## Firestore Schema (summary)

All docs under `users/{uid}/` for tenant isolation. Clients read; Cloud Agent Admin SDK owns writes.

| Path | Purpose |
|------|---------|
| `sessions/{sessionId}` | Bridge session status, instance IDs, TTL |
| `sessions/{sessionId}/tasks/{taskId}` | Task intent, status, result, `haltedStepIndex` |
| `sessions/{sessionId}/auth/{taskId}` | Approval status, `approvalToken` (mobile writes approval only) |
| `devices/{deviceId}` | FCM token, `isPaused`, `lastSeenAt` |

Security rules: `firestore.rules` at repo root.

---

## Extension Development

```bash
cd extension
npm install
npm run build          # esbuild → dist/ (env from repo-root .env)
npm run typecheck
npm test
```

Load `extension/dist/` as an unpacked extension in Chrome. Requires repo-root `.env` / `.env.development.local` with `EXPO_PUBLIC_FIREBASE_*` and `EXPO_PUBLIC_CLOUD_AGENT_URL`.

Key directories:

| Path | Role |
|------|------|
| `extension/src/background/service-worker.ts` | FCM receiver, WS lifecycle |
| `extension/src/background/ws-client.ts` | WebSocket + heartbeat |
| `extension/src/background/task-dispatcher.ts` | Task DSL routing |
| `extension/src/content/executor.ts` | DOM action runners |
| `extension/src/ui/side-panel/` | Sign-in, status, pause, host grant |

---

## Cloud Agent Development

Browser bridge requires Firebase Admin (Firestore + FCM). Local Docker setup: see [AI & Chat — Local Development](ai-and-chat.md#local-development-cloud-agent).

```bash
cd cloud-agent
npm run typecheck
npm test
```

---

## Related Documentation

- **[AI & Chat](ai-and-chat.md)** — Cloud Agent text paths, local dev
- **[Real-Time Voice Chat](real-time-voice-chat.md)** — `/agent/live` sessions, `browser_action` during calls
- **[Edge Agent](edge-agent.md)** — On-device text loop (no `browser_action`)
- **[Billing & Credits](billing-and-credits.md)** — Credit ledger, contextual `browser_action` billing
- **[Architecture & Data](architecture-and-data.md)** — Firestore bridge vs local SQLite
- **[Architecture Charts — C4](flowcharts/c4/containers.md)** — Container diagram with browser bridge routing
