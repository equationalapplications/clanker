# Phase 4: Edge Completion, JIT Sync & Evaluation Pipeline

**Date:** 2026-06-01
**Status:** Ready for Implementation
**Branch:** `feat/phase-4`
**Scope:** Finalize edge capabilities (Task Management), implement JIT Escalation Sync, build the Firebase ingestion bridge, and establish the LLM evaluation pipeline. Depends on Phase 3 (`write_observation` edge tool).

**Related Docs:**
- Phase 1: [Edge Agent Chat Architecture](2026-05-28-edge-agent-chat-architecture.md)
- Phase 2: [Manifest Override + Local `search_memory`](2026-05-28-manifest-override-memory-search-design.md)
- Phase 3: [Edge Memory Writing — `write_observation`](2026-06-01-edge-write-observation.md)
- Implementation Plan: [2026-06-01-phase4-edge-tasks-evals-plan.md](../plans/2026-06-01-phase4-edge-tasks-evals.md)

---

## 1. Problem

The edge agent can now read and write local wiki memory (Phases 2–3). Three gaps remain before the edge layer can be considered feature-complete and safe to migrate the backend to Cloud Run:

1. **No offline task management.** The ADK Sandbox has proven the `create_task` / `list_tasks` pattern. The edge Expo client has no equivalent — task intents escalate unconditionally to Firebase even when the device is offline.

2. **No routing confidence.** There are no tests that verify the LLM correctly selects the right tool (or produces plain text) given the production manifests. A bad manifest description or prompt regression is invisible until users report it.

3. **No prompt correctness guarantee.** `CharacterPromptBuilder` has no assertion covering the "do not break the fourth wall" directive. A refactor could silently remove it.

Additionally, two previously designed components now need wiring:
- JIT Escalation Sync: unsynced offline messages must be batched into the Firebase payload on escalation.
- Firebase Ingestion Bridge: the cloud function must bulk-insert that unsynced history into Cloud SQL before generating a reply.

> **Note:** Investigation of the codebase reveals that JIT Escalation Sync (`useAIChat.ts:128-150`) and the Firebase Ingestion Bridge (`generateReply.ts:494-532`) are **already fully implemented**. The implementation plan covers only the remaining gaps.

---

## 2. Goals

### 2.1 Evaluation & Testing Pipeline (dual-layer)

**Deterministic prompt tests** (`src/services/__tests__/characterPromptBuilder.test.ts`):
- Assert `buildSystemInstruction` includes the character's traits, personality, and the "Never reveal you are an AI" fourth-wall directive.
- Assert `buildContentHistory` correctly maps `IMessage[]` into `{ role, parts }[]` format.

**LLM-in-the-loop evals** (`src/services/__tests__/edgeAgentEvals.int.test.ts`):
- Initialize a real `@google/genai` client using `process.env.GOOGLE_GENAI_API_KEY`.
- Use `gemini-2.5-flash` with `temperature: 0` and production edge tool manifests.
- **Test A:** Asking about a past fact yields a `search_memory` tool call.
- **Test B:** Asking to write a long essay yields an `escalate_to_cloud_agent` tool call.
- **Test C:** Casual chatting yields plain text with no tool calls.
- Add `"edge-evals": "jest --testRegex '.*\\.int\\.test\\.ts$' --runInBand"` to `package.json`. These tests never run in CI — only manually.

### 2.2 JIT Escalation Sync (Delta Handoff)

On escalation, all chat messages and observations where `synced_at IS NULL` must be included in the Firebase payload so the cloud agent has full context. After Firebase returns `200 OK`, mark those message IDs as synced in the local SQLite database.

- Query: `SELECT * FROM messages WHERE character_id = ? AND synced_at IS NULL`
- Payload: `{ escalated: true, unsyncedHistory: localDeltaArray }`
- Cleanup: bulk `UPDATE messages SET synced_at = ? WHERE id IN (...)`

### 2.3 Edge Task Management (Sandbox Parity)

Empower the edge agent to manage tasks offline, matching the capability already proven in the ADK Sandbox.

**Manifests (`clankerManifests.ts`):**
- Export `clankerCreateTaskSchema` (required: `title: string`).
- Export `clankerListTasksSchema` (no required params).
- Update `clankerEscalationSchema` description to explicitly forbid delegating task creation/listing to the cloud.

**Database (`src/database/schema.ts` + `src/database/taskDatabase.ts`):**
- Migration v19: `CREATE TABLE IF NOT EXISTS tasks (id, character_id, title, status, created_at)` with index on `character_id`.
- Add tasks table to `CREATE_TABLES` (fresh installs).
- `createTask(characterId, title)` → inserts row, returns generated id.
- `listTasks(characterId)` → returns rows ordered by `created_at DESC`.

**Executors (`edgeToolExecutors.ts`):**
- `create_task`: validate title, call `createTask`, return success/failure string.
- `list_tasks`: call `listTasks`, return JSON array or "No tasks found."
- Both added to the `createEdgeToolExecutors` factory alongside the memory tools.

**Injection (`useEdgeAgent.ts`):**
- Push `clankerCreateTaskSchema` and `clankerListTasksSchema` into `functionDeclarations` unconditionally (tasks are available offline regardless of `wiki` or `isCloudSynced`).

### 2.4 Firebase Ingestion Bridge

Before passing `contents` to the LLM, `functions/src/generateReply.ts` must:
1. Extract `unsyncedHistory` from the request payload.
2. Verify the `characterId` belongs to the authenticated user.
3. Bulk `INSERT ... ON CONFLICT DO NOTHING` into the Cloud SQL `messages` table.
4. Continue with LLM generation regardless of insert errors (non-fatal).

---

## 3. Design Decisions

### Tasks are wiki-independent

Task tools inject unconditionally — not gated on `wiki !== null`. Tasks are a separate offline capability backed by the local SQLite `tasks` table, not by the `expo-llm-wiki` package. A character without wiki enabled should still support task creation.

### `.int.test.ts` extension as CI gate

The project's `jest.testMatch` patterns match `**/__tests__/**/*.test.ts` — they do not match `*.int.test.ts`. The `edge-evals` script uses `--testRegex` to exclusively target integration tests. This keeps token-consuming network calls out of standard CI without any additional jest config changes.

### `temperature: 0` for eval determinism

LLM routing evals use `temperature: 0` to maximize reproducibility. If a test is flaky (model sometimes returns text instead of a tool call), the fix is to strengthen the prompt stimulus — not to retry or soften the assertion.

### Migration skip guard for tasks table

Migration 19 uses `{ table: 'tasks', column: 'id' }` as its skip guard. If `tasks.id` already exists (e.g., the table was created by `CREATE_TABLES` on a fresh install), the migration is skipped. This is safe because the `CREATE TABLE IF NOT EXISTS` in `CREATE_TABLES` is idempotent.

---

## 4. Out of Scope

- Cloud Run migration (Phase 5).
- Task status updates (`update_task`, `complete_task`) — list and create are sufficient for sandbox parity.
- Syncing tasks to Cloud SQL — tasks are offline-only in this phase.
- `list_tasks` filter by status — return all tasks for the character; LLM can filter in natural language.
