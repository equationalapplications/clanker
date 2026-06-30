# Edge Agent (BYOI Proxy Architecture)

## Overview

The edge agent is Clanker's on-device orchestration layer for chat. It runs a multi-turn tool-calling loop in the Expo client, but **never calls Gemini directly**. Every inference step is delegated to the secured `generateReply` Firebase callable (Bring Your Own Inference / BYOI proxy).

This matches the app-wide AI access policy in [AI & Chat](ai-and-chat.md): production runtime makes no client-side GenAI model calls. Type-only `@google/genai` imports are allowed; developer-only eval harnesses (`npm run edge-evals`) are excluded.

**Talk tab live voice** is a separate path: continuous Gemini Live over Cloud Agent `/agent/live`, not the edge agent loop. See **[Real-Time Voice Chat](real-time-voice-chat.md)**.

**Desktop browser tasks** are a separate path: Cloud Agent `browser_action` tool wakes the MV3 Desktop Bridge extension. The edge agent does not register or execute `browser_action` — it requires Cloud Agent, Firestore coordination, and a paired extension. See **[Browser Bridge](browser-bridge.md)**.

---

## Architecture

```text
User message
      ↓
useAIChat
      ↓
useEdgeAgent (client orchestration loop, max 5 iterations)
      │
      ├── CharacterPromptBuilder → systemInstruction + contents[]
      │
      ├── generateChatReply() → generateReply (Firebase callable, App Check, Vertex AI)
      │         ↓
      │   functionCalls in response?
      │   ├── execute locally via edgeToolExecutors (SQLite wiki, tasks, etc.)
      │   │     → push functionResponse into contents → loop again
      │   └── escalate_to_cloud_agent (cloud-synced only) → escalation
      │
      └── text reply → save to SQLite → done (no cloud-agent / sendMessageWithAIResponse)
```

**Inference vs orchestration:** The client owns the loop and executes tools against local SQLite (`@equationalapplications/expo-llm-wiki`). The server owns model access, auth, App Check, and billing.

**Key files:**

| Layer | File |
|---|---|
| Hook (loop) | `src/hooks/useEdgeAgent.ts` |
| Chat integration | `src/hooks/useAIChat.ts` |
| Proxy client | `src/services/chatReplyService.ts` |
| Tool executors | `src/services/edgeToolExecutors.ts` |
| Tool schemas | `shared/agent-tools-spec.ts` (`getSchemasForEdge`) |
| Backend proxy | `functions/src/generateReply.ts` |

---

## BYOI Proxy Contract

Each loop iteration sends structured payload to `generateReply`:

```json
{
  "contents": [/* multi-turn history with text, functionCall, functionResponse parts */],
  "systemInstruction": "string",
  "tools": [{ "name": "...", "description": "...", "parameters": {} }]
}
```

The callable returns either:

- `{ "reply": "...", "remainingCredits": N, ... }` — final text for this iteration, or
- `{ "functionCalls": [{ "name": "...", "args": {} }], "remainingCredits": N, ... }` — tool decision; client executes and loops.

Model selection (`gemini-3.5-flash`, etc.) happens server-side in `generateReply`. The client does not embed API keys or choose models.

When `tools` is present, the backend omits the `googleSearch` grounding tool (Gemini cannot mix `googleSearch` with custom `functionDeclarations` in one request). Plain chat callers without `tools` keep `googleSearch` as before.

---

## Escalation Paths

After the edge loop, `useAIChat` routes in priority order:

1. **Edge resolved** — loop returned text; messages saved locally.
2. **Cloud Agent** — cloud-synced character with `cloud_id` and `EXPO_PUBLIC_CLOUD_AGENT_URL` set → `callCloudAgent` (ADK service on Cloud Run / local Docker).
3. **Firebase escalation** — `sendMessageWithAIResponse` with unsynced history batch for JIT sync.

### Local-only airgap

`escalate_to_cloud_agent` is only advertised in tool schemas when `isCloudSynced` is true (`character.save_to_cloud`). Local-only characters cannot escalate via that tool.

Cloud Agent escalation (and live voice) can invoke `browser_action` for desktop browser tasks. The edge agent loop never sees this tool — it is injected only in Cloud Agent ADK tool sets (`liveToolAdapter.ts`, `agentCore.ts`).

### Escalation phantom tools

`set_reminder` is cloud-only; the edge executor returns a sentinel that triggers escalation when cloud sync is enabled.

---

## Billing

**1 credit per `generateReply` round-trip.** Every proxy call — including intermediate tool-decision steps — reserves one credit before the Vertex call and refunds on model failure.

A multi-tool turn (e.g. wiki read → graph traverse → final reply) costs one credit per loop iteration, up to the `MAX_ITERATIONS = 5` cap.

The old "edge-resolved = free" policy is retired. Edge resolution only skips the separate `sendMessageWithAIResponse` / cloud-agent paths; it does not skip proxy billing.

`useEdgeAgent` returns the latest `usageSnapshot` from the most recent proxy call. `useAIChat` forwards it to the auth machine so the credit counter updates in the UI.

---

## Security

- **No `EXPO_PUBLIC_GEMINI_API_KEY`** (or any client-bundled Gemini key) in production app code.
- App Check is enforced on `generateReply`.
- Vertex credentials live server-side only.

### Developer eval harness (acceptable exception)

`src/services/__tests__/edgeAgentEvals.int.test.ts` uses `GOOGLE_GENAI_API_KEY` via `process.env` in a Node.js Jest harness. This is manual, local-only evaluation — not shipped in the React Native bundle and not run in CI.

---

## Local Development

### Hybrid mode (recommended)

Use real Firebase login against `clanker-prod` (or staging) for `generateReply`, App Check, and bootstrap — while routing cloud-agent escalation and Talk tab live voice to local Docker:

```bash
# .env.development.local
EXPO_PUBLIC_CLOUD_AGENT_URL=http://<YOUR_LAN_IP>:8080
# EXPO_PUBLIC_USE_MOCK_AUTH unset or false
```

Start local backend:

```bash
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml exec cloud-agent npx tsx scripts/seedLocal.ts
npx expo start -w
```

When `EXPO_PUBLIC_CLOUD_AGENT_URL` points at localhost or a private LAN IP, dev builds automatically rewrite outbound cloud-agent `characterId` values to the seeded `DEV_CLOUD_CHARACTER_ID` in local Postgres. No need to seed your production character UUIDs locally.

Chat follows the same escalation pattern as production: edge loop via `generateReply` first, then cloud-agent on model escalation.

### Legacy mock-auth mode

`EXPO_PUBLIC_USE_MOCK_AUTH=true` bypasses Firebase Auth. This **cannot** call production `generateReply` (the Firebase SDK has no real auth token). Prefer hybrid mode for edge-loop testing.

### Dev sandbox (`EXPO_PUBLIC_USE_MOCK_AUTH`)

Mock auth bypasses Firebase login and returns a fake bootstrap snapshot. It does **not** bypass `generateReply` or enable client-side Gemini calls. Chat inference still goes through the Firebase callable (or staging functions when using hybrid mode).

For local cloud-agent iteration, set `EXPO_PUBLIC_CLOUD_AGENT_URL` to your Docker instance. See [AI & Chat — Local Development](ai-and-chat.md#local-development-cloud-agent).

> **Historical note:** An earlier dev-sandbox design described a local-Gemini mock path using `EXPO_PUBLIC_GEMINI_API_KEY`. That path was implemented briefly and **removed during the BYOI proxy migration**.

---

## Related Documentation

- [AI & Chat](ai-and-chat.md) — `generateReply` contract, wiki memory, cloud-agent local dev
- [Browser Bridge](browser-bridge.md) — Desktop extension, `browser_action`, Wake-and-Connect (cloud-only)
- [Real-Time Voice Chat](real-time-voice-chat.md) — Talk tab Gemini Live sessions (`/agent/live`), separate from edge agent
- [Billing & Credits](billing-and-credits.md) — credit ledger and subscription tiers
