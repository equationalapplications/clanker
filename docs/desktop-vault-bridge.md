# Desktop Vault Bridge (Curated Thoughts)

## Overview

The **Desktop Vault Bridge** lets the Cloud Agent query a user's home knowledge vault (Curated Thoughts on their desktop) mid-turn via five read-only `vault_*` ADK tools. Curated Thoughts holds a persistent outbound WebSocket to `/agent/desktop`; the cloud agent writes task docs to Firestore and watches for results.

Like `browser_action`, the edge agent and Firebase `generateReply` path never see these tools. Only Cloud Agent (`/agent/live` voice or `/agent/run` text) has them.

Counterpart spec: `curated-thoughts/docs/superpowers/specs/2026-07-01-clanker-cloud-bridge-design.md`. Clanker design spec: `docs/superpowers/specs/2026-07-05-desktop-vault-bridge-design.md`.

---

## Three-Node Architecture

| Node | Role | Connection |
|------|------|------------|
| Mobile app | Pair/revoke desktop, chat I/O | `POST /agent/desktop/pair`, `/agent/run` |
| Cloud Agent | Task writer, socket-owning instance dispatches | `/agent/desktop` WebSocket + `desktopBridge` same-instance shortcut |
| Curated Thoughts | Vault executor on user hardware | Persistent outbound WS with pairing-token auth |

**Key invariant:** Cloud Run instances never communicate directly. All cross-instance routing flows through Firestore (`users/{uid}/desktopTasks/{taskId}`). The socket-owning instance runs a snapshot listener on pending tasks; tool-calling instances write task docs and `watchTask` for results.

```text
Tool-calling instance                     Socket-owning instance
  vault_wiki_search                          (holds CT WebSocket)
    │ 1. check device doc (online?)             │
    │ 2. write desktopTasks/{taskId} pending    │
    │ 3. watchTask(taskId), 12s timeout         │ 4. snapshot listener fires
    │                                           │ 5. send {taskId, tool, params} over WS
    │                                           │ 6. CT replies {taskId, result|error}
    │ 8. watchTask resolves ◄───────────────────│ 7. write result to task doc
```

---

## Pairing

1. Mobile/web Settings → Devices → **Pair home computer** → `POST /agent/desktop/pair` with `{ deviceName }`.
2. Server returns `{ pairingToken, deviceId }` — raw token shown exactly once (~43 char base64url).
3. User pastes token into Curated Thoughts Settings (OS keychain).
4. CT connects to `wss://…/agent/desktop` with first-frame auth: `{ "type": "auth", "pairingToken": "…" }`.
5. Revocation: `POST /agent/desktop/revoke` with `{ deviceId }` deletes device doc and pairing mapping; live socket closes via device-doc listener.

---

## WebSocket Frames

| Direction | Frame |
|---|---|
| CT → Clanker | `{ "type": "auth", "pairingToken" }` (first frame, 5s timeout) |
| Clanker → CT | `{ "type": "ready" }` |
| CT → Clanker | `{ "type": "ping" }` every 20s |
| Clanker → CT | `{ "type": "pong" }` |
| Clanker → CT | `{ "type": "task", "taskId", "tool", "params" }` |
| CT → Clanker | `{ "type": "task_result", "taskId", "result" }` |
| CT → Clanker | `{ "type": "task_error", "taskId", "error": { "code", "message" } }` |

**Liveness:** `lastSeenAt` refreshed at most every 40s. `getActiveDesktopDevice` requires `lastSeenAt` within 90s.

---

## ADK Tools (`vault_*`)

| ADK tool (Gemini) | CT wire `tool` value |
|---|---|
| `vault_wiki_search` | `wiki_search` |
| `vault_get_ontology` | `wiki_get_ontology` |
| `vault_traverse_graph` | `wiki_traverse_graph` |
| `vault_semantic_search` | `vault_semantic_search` |
| `vault_related_chunks` | `vault_related_chunks` |

Wiring: `buildAgent` in `agentCore.ts` (text), `buildLiveTools` in `liveToolAdapter.ts` (voice).

**Per-turn cap:** 5 calls shared across the family. After the first `DESKTOP_TIMEOUT` or `DESKTOP_DISCONNECTED`, remaining budget drops to 1.

**Billing:** No flat `spendCredit`. Text path is pre-billed per turn; voice path pauses wall-clock billing during vault fetch (no additional credit spend).

---

## Error Codes

| Code | Surfaced to model |
|---|---|
| `DESKTOP_OFFLINE`* | No home computer connected |
| `DESKTOP_TIMEOUT` | Didn't respond in time |
| `DESKTOP_DISCONNECTED` | Same as timeout |
| `TOOL_ERROR` | CT error message, prefixed |

*`DESKTOP_OFFLINE` is a synthesized message returned by `vaultTools` before any task doc is written; it is not a `DesktopTaskError.code` value stored in Firestore. Only `DESKTOP_TIMEOUT`, `DESKTOP_DISCONNECTED`, and `TOOL_ERROR` are persisted.

---

## Failure Modes

| Failure | Cleanup |
|---|---|
| Socket-owner crashes with task `pending` | Caller's 12s `watchTask` timeout marks `failed` |
| Socket dies mid-call | `DESKTOP_DISCONNECTED` + caller timeout |
| Tool-calling instance dies | Firestore TTL on `expiresAt` (1h) |
| Stale `online: true` after crash | `lastSeenAt` staleness (90s) + CT reconnect |

No cron or sweeper — the caller timeout is the primary janitor.

---

## Firestore Schema

| Path | Access |
|---|---|
| `users/{uid}/devices/{deviceId}` | Client read; `type: 'desktop'` for CT devices |
| `desktopPairings/{tokenHash}` | Admin SDK only (denied in rules) |
| `users/{uid}/desktopTasks/{taskId}` | Admin SDK only (denied in rules) |

**Ops:** Enable TTL on `desktopTasks.expiresAt`:

```bash
gcloud firestore fields ttls update expiresAt --collection-group=desktopTasks --enable-ttl
```

Monitor `DESKTOP_TIMEOUT` frequency and TTL-reaped doc counts.

---

## Local Development

```bash
cd cloud-agent
npm run typecheck
npm test
```

Manual smoke client:

```bash
docker compose -f docker-compose.local.yml up -d
PAIRING_TOKEN=<token> CLOUD_AGENT_URL=ws://localhost:8080 npx tsx scripts/desktopBridgeSmoke.ts
```

Pair via `POST /agent/desktop/pair` with a valid auth token, then send a chat turn through `POST /agent/run` asking to search the vault.

---

## Related Documentation

- **[Browser Bridge](browser-bridge.md)** — extension bridge (wake-per-task contrast)
- **[AI & Chat](ai-and-chat.md)** — Cloud Agent local dev
- **[Billing & Credits](billing-and-credits.md)** — contextual billing patterns
