# Desktop Vault Bridge — Clanker Side (`/agent/desktop` + `query_local_vault`)

**Date:** 2026-07-05
**Status:** Draft
**Counterpart spec (approved):** `curated-thoughts/docs/superpowers/specs/2026-07-01-clanker-cloud-bridge-design.md` — defines the Curated Thoughts `CloudBridgeClient`, the five read-only tool contracts, and the §5 contract this spec implements.
**Structural precedents in this repo:** `cloud-agent/src/handlers/wsBrowserAgentHandler.ts` (WS auth/lifecycle), `cloud-agent/src/tools/browserAction.ts` (fail-fast device resolution, contextual billing, durable `watchTask` result delivery), `docs/browser-bridge.md` (three-node architecture and Firestore-as-bus invariant).

## 1. Summary

Adds the Clanker side of the desktop vault bridge: a persistent WebSocket route (`/agent/desktop`) that Curated Thoughts connects to outbound, a `type: "desktop"` device registration with pasted-pairing-token auth, and a new ADK tool `query_local_vault` available to Cloud Agent text (`/agent/run`) and voice (`/agent/live`) paths. The tool lets Gemini query the user's home knowledge vault (wiki entries, graph edges, semantic chunks) mid-turn via five read-only tool contracts defined in the Curated Thoughts spec and reused verbatim.

Like `browser_action`, the edge agent and Firebase `generateReply` path never see this tool.

## 2. Key architectural difference from the browser bridge

The browser bridge is **wake-per-task**: FCM wakes the extension, one task per session, socket closes. Curated Thoughts holds a **persistent outbound socket** with reconnect/backoff (CT spec §4). Consequences:

- **No FCM, no wake timeout.** A vault call either dispatches to a live connection or fails fast (`DESKTOP_OFFLINE`) with no credit spent — mirroring `browser_action`'s no-device fail-fast.
- **Cross-instance routing still applies.** The CT socket lands on one Cloud Run instance; an agent turn may run on another. Instances never communicate directly (repo invariant). Routing bus is Firestore: the **socket-owning instance** holds a snapshot listener on the connected device's pending-task queue and dispatches over its local socket; the **tool-calling instance** writes the task doc and `watchTask`es the result. A `desktopBridge` same-instance registry (mirroring `sessionBridge`) short-circuits the dispatch when both land on the same instance; Firestore remains the canonical state either way.
- **Sessions are connection-scoped, not task-scoped.** No `sessions/{sid}` docs. Task docs live in a flat per-user collection (§6).

```text
Tool-calling instance                     Socket-owning instance
  query_local_vault                          (holds CT WebSocket)
    │ 1. check device doc (online?)             │
    │ 2. write desktopTasks/{taskId} pending    │
    │ 3. watchTask(taskId), 10s timeout         │ 4. snapshot listener fires
    │                                           │ 5. send {taskId, tool, params} over WS
    │                                           │ 6. CT replies {taskId, result|error}
    │ 8. watchTask resolves ◄───────────────────│ 7. write result to task doc
```

## 3. Non-goals (mirrors CT spec §3)

- No write path — none of the five tools mutate the vault; the review queue has no wire path from here.
- No offline task queue — no pending dispatch survives a disconnected desktop.
- No QR/device-code pairing — v1 is pasted token only.
- No new wire protocol — tool names, params, and result shapes come from `2026-06-23-mcp-wiki-graph-tools-design.md` (CT repo) unchanged.
- No extension/browser-bridge changes. `getActiveDevice` gains a type filter (§6) but its behavior for browser devices is unchanged.

## 4. Pairing

1. Mobile/web Settings → Devices → **"Pair home computer"** → `POST /agent/desktop/pair` (`requireAuth`, `authRouteLimiter`) with `{ deviceName }`.
2. Server generates `deviceId` (UUID) and a pairing token: 32 bytes CSPRNG, base64url (~43 chars). Returns `{ pairingToken, deviceId }` — **raw token appears exactly once in this response** and is never persisted raw or logged.
3. Server writes:
   - `users/{uid}/devices/{deviceId}`: `{ type: 'desktop', deviceName, isPaused: false, online: false, lastSeenAt: null, createdAt }` — **no token material here**; device docs may be client-readable under existing rules.
   - `desktopPairings/{tokenHash}`: `{ uid, deviceId, createdAt }` where `tokenHash = sha256(pairingToken)` hex. Top-level collection, Admin SDK only, denied to all clients in `firestore.rules`.
4. User pastes token into Curated Thoughts Settings (stored in OS keychain, per CT spec §6).
5. Revocation: Settings → Devices → remove → `POST /agent/desktop/revoke` `{ deviceId }` deletes the device doc and its `desktopPairings` mapping (lookup by `deviceId` field query), and the socket-owning instance closes any live socket for that device (it observes the device-doc delete via its listener). Pause semantics reuse `isPaused` exactly like browser devices.

One token ↔ one device ↔ one uid. Re-pairing a machine = revoke + new pair flow.

## 5. WebSocket `/agent/desktop`

Registered in `cloud-agent/src/index.ts` alongside `/agent/browser` (`noServer` WSS + `upgrade` dispatch), only when Firebase Admin is initialized. New handler `cloud-agent/src/handlers/wsDesktopAgentHandler.ts`, structurally mirroring `wsBrowserAgentHandler.ts`.

**Auth (first frame, 5s timeout, mirror of browser handler):**

```jsonc
// CT → Clanker
{ "type": "auth", "pairingToken": "<base64url>" }
```

Server hashes the token, reads `desktopPairings/{tokenHash}`. Unknown hash, missing device doc, or `isPaused: true` → close `4001`. On success:

1. Update device doc: `{ online: true, connectedInstanceId: instanceId, lastSeenAt: now }`.
2. Register socket in `desktopBridge` registry keyed by `uid:deviceId`.
3. Start a Firestore snapshot listener: `users/{uid}/desktopTasks` where `status == 'pending'` and `deviceId == deviceId`.
4. Send `{ "type": "ready" }`.

If the same device connects twice (e.g. reconnect racing the dead socket), the new connection wins: the handler closes the previous socket for that `uid:deviceId` before registering.

**Steady state frames:**

| Direction | Frame |
|---|---|
| CT → Clanker | `{ "type": "ping" }` every 20s (same shape/interval as `extension/src/background/ws-client.ts`) |
| Clanker → CT | `{ "type": "pong" }` |
| Clanker → CT | `{ "type": "task", "taskId", "tool", "params" }` |
| CT → Clanker | `{ "type": "task_result", "taskId", "result" }` |
| CT → Clanker | `{ "type": "task_error", "taskId", "error": { "code", "message" } }` |

All frames validated with zod; malformed frames are ignored pre-auth-style (auth frame errors close `4001`, post-auth malformed frames are dropped and logged).

**Liveness:** device doc `lastSeenAt` is refreshed at most once per 60s (every third heartbeat) to bound Firestore write volume. No pong received by CT, or no ping received by Clanker, for 45s → each side treats the connection as dead (CT spec §4); Clanker's close handler runs the disconnect path.

**Disconnect path (`close`/`error`):** deregister from `desktopBridge`, unsubscribe the task listener, update device doc `{ online: false, connectedInstanceId: null }`. In-flight tasks dispatched over this socket are failed immediately with `DESKTOP_DISCONNECTED` so the tool-calling instance's `watchTask` resolves without waiting out its timeout.

**Cloud Run constraint:** the WS lives at most one Cloud Run request timeout (60 min ceiling). CT's auto-reconnect (backoff 1s → 30s, per its spec) makes this a brief periodic offline window, not a failure mode. Session affinity is not required for correctness — only `connectedInstanceId` freshness.

## 6. Firestore schema changes

| Path | Change |
|---|---|
| `users/{uid}/devices/{deviceId}` | New optional fields: `type` (`'desktop'`; absent = browser), `online`, `connectedInstanceId`. Browser device docs untouched. |
| `desktopPairings/{tokenHash}` | **New top-level collection**: `{ uid, deviceId, createdAt }`. `firestore.rules`: deny all client reads/writes. |
| `users/{uid}/desktopTasks/{taskId}` | **New collection**: `{ status: 'pending' \| 'executing' \| 'complete' \| 'failed', deviceId, tool, params, result, error, createdAt, updatedAt, expiresAt }`. Client access denied (Admin SDK only). `expiresAt` + Firestore TTL policy handles cleanup (1 hour). |

`getActiveDevice` (browser path) adds an in-memory filter `data.type !== 'desktop'` next to the existing `isPaused` filter — desktop devices must never be selected for `browser_action` wake. New `getActiveDesktopDevice(uid)`: same query, filters `type === 'desktop' && !isPaused && online === true && lastSeenAt within 90s`, most-recent first. Requires no new composite index (same `active`/`lastSeenAt` query shape); desktop registration writes `active: true` the same way `deviceUpsert.ts` does for browser devices, so both device types share the one indexed query.

## 7. ADK tool: `query_local_vault`

New `cloud-agent/src/tools/queryLocalVault.ts`, wired exactly where `browser_action` is wired: `buildAgent` in `agentCore.ts` (text) and `buildLiveTools` in `liveToolAdapter.ts` (voice). Never in edge-agent schemas (`shared/agent-tools-spec.ts` untouched).

**Schema (single dispatcher tool, per CT spec §5):**

```ts
const queryLocalVaultSchema = z.object({
  tool: z.enum(['wiki_search', 'wiki_get_ontology', 'wiki_traverse_graph',
                'vault_semantic_search', 'vault_related_chunks']),
  params: z.record(z.string(), z.unknown())
    .describe('Parameters for the selected tool — contracts defined by the Curated Thoughts MCP tool spec.'),
})
```

Description tells Gemini to use it for questions about the user's own notes, documents, and knowledge base ("what do I know about…", "check my notes/vault for…"). Per-tool param documentation is embedded in the description string, copied from the CT tool contracts. *(v2 option, deliberately deferred: split into five named ADK tools for better model tool-choice; kept singular in v1 to match the approved CT contract.)*

**Execute flow (mirrors `browserAction.ts` shape):**

1. `getActiveDesktopDevice(uid)` — none → return `'No home computer is connected. Open Curated Thoughts on your desktop, or check Settings → Devices.'` — **no credit spent, no task doc written**.
2. Per-turn call cap: 5 (counter in tool deps, created per turn like `BrowserActionDeps`). Over cap → return an error string instructing the model to answer with what it has.
3. Write `desktopTasks/{taskId}` with `status: 'pending'`.
4. Same-instance shortcut: if `desktopBridge` holds the socket locally, dispatch immediately (still transition the doc `pending → executing` so the durable state is truthful).
5. `watchTask` on the doc with a **10s timeout** (CT spec §4: covers RTT + cold embedder load). Timeout → mark doc `failed` (`DESKTOP_TIMEOUT`), return an apologetic error string.
6. Format result for the model: JSON-stringified `result` (these are compact retrieval payloads — entries/chunks — not DOM dumps; no truncation in v1 beyond the existing model context limits).

**Billing: no flat credit spend.** Decision: vault reads execute on the user's own hardware and return in sub-second steady state.
- Text path: already pre-billed 1 credit/turn — no additional spend (same as `browser_action`'s `preBilled: true` path).
- Voice path: `pauseBilling`/`resumeBilling` around the call (mirror `browser_action`) so wall-clock billing doesn't tick during a vault fetch, but **no** `spendCredit` — unlike `browser_action`, there is no scarce device wake or long execution to meter. Revisit only if per-turn chaining abuse shows up (the 5-call cap bounds it).

**Chaining:** the agent may chain vault calls within a turn (e.g. `wiki_search` → `wiki_traverse_graph`), bounded by the 5-call cap plus the existing agent-loop iteration cap and the 30s text-path load-balancer ceiling. CT imposes no cap of its own (its spec §4).

## 8. Error codes

| Code | Meaning | Surfaced to model as |
|---|---|---|
| `DESKTOP_OFFLINE` | No connected, unpaused desktop device | "No home computer is connected…" |
| `DESKTOP_TIMEOUT` | No result within 10s | "Your home computer didn't respond in time." |
| `DESKTOP_DISCONNECTED` | Socket died mid-call | same as timeout |
| `TOOL_ERROR` | CT returned `task_error` (bad params, vault error) | CT's error message, prefixed |

## 9. Security

- Raw pairing tokens: returned once, never stored, never logged (hash-only lookup). Token entropy 256 bits.
- `desktopPairings` and `desktopTasks` are Admin-SDK-only; `firestore.rules` denies all client access. Device docs carry no secret material.
- The channel is read-only by construction — no mutating tool is exposed, matching CT spec §6 ("enforced by simply not exposing any mutating tool").
- `/agent/desktop/pair` and `/agent/desktop/revoke` sit behind `requireAuth` + `authRouteLimiter`. The WS auth path rate-limits failed auth frames per connection (single attempt, close on failure) and relies on Cloud Run ingress limits for connection floods.
- Vault results are user-memory-grade content entering the prompt; the existing prompt-injection posture for `[MEMORY]` blocks applies (treat retrieved text as data, not instructions — same trust boundary as wiki memory today).

## 10. Testing plan

Mirrors existing test shapes; no new harness inventions:

- `wsDesktopAgentHandler.test.ts` — auth frame validation, token-hash resolution, duplicate-connection replacement, heartbeat, disconnect path, in-flight failure on close (pattern: `wsBrowserAgentHandler.test.ts` with fake `FirestoreLike`).
- `queryLocalVault.test.ts` — fail-fast no-device, per-turn cap, timeout marking, result formatting, no-spend assertion on both paths (pattern: `browserAction.test.ts`).
- `firestoreSession.test.ts` additions — `getActiveDesktopDevice` filtering (type/paused/online/staleness) and the `type !== 'desktop'` exclusion in `getActiveDevice`.
- Integration smoke — `docker-compose.local.yml` stack + a scripted mock desktop client (Node `ws`) speaking the auth/task frames; end-to-end `wiki_search` round trip through `/agent/run`. Real Curated Thoughts pairing is the manual smoke test, per CT spec §7.

## 11. Out of scope / follow-ups

- CT-side `CloudBridgeClient` — already planned (`curated-thoughts/docs/superpowers/plans/2026-07-01-clanker-cloud-bridge-implementation.md`).
- Settings → Devices UI in the mobile app (pair/revoke buttons calling the new routes) — small client PR, spec'd here only as the two routes.
- Five-tool ADK split, result caching, multi-desktop selection UX, write-back/review-queue wire path: all deferred.
