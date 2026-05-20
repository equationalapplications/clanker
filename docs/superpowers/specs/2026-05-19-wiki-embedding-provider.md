# Spec: Wiki Embedding Provider

Date: 2026-05-19
Status: Implemented
Branch: feat/wiki-embedding-provider
PR: https://github.com/equationalapplications/clanker/pull/386

> **Note:** This document describes the embedding-provider architecture that was implemented on top of the existing `expo-llm-wiki` integration. The current repository uses `@equationalapplications/expo-llm-wiki@4.9.0`.

**Goal:** Add vector embedding support to Clanker's wiki system via a new `generateEmbedding` Firebase callable function, enabling the `expo-llm-wiki` package's cosine similarity retrieval path.

**Architecture:** A new lightweight `generateEmbedding` callable authenticates the Firebase user (auth check only — no DB user bootstrap, no subscription gate), then calls the Vertex AI `text-embedding-004` model via REST using Application Default Credentials obtained from `firebase-admin`. The client-side `wikiLlmProvider` adds an `embed` method that calls this function, which activates the vector ranking path inside `expo-llm-wiki`. The function follows the same auth-only pattern used by lightweight callables in this codebase.

**Tech Stack:** Firebase Functions v2 (`onCall`), `firebase-admin` (ADC), Vertex AI Embedding REST API (`text-embedding-004`, 768 dims), `httpsCallable`, Node.js `node:test` + `node:assert/strict`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `functions/src/generateEmbedding.ts` | Callable function: auth check, input validation, Vertex AI REST call |
| Create | `functions/src/generateEmbedding.test.ts` | Unit tests with DI mock for embedder |
| Modify | `functions/src/index.ts` | Export `generateEmbedding` |
| Modify | `src/config/firebaseConfig.ts` | Add `generateEmbeddingFn` httpsCallable (native) |
| Modify | `src/config/firebaseConfig.web.ts` | Add `generateEmbeddingFn` httpsCallable (web) |
| Modify | `src/services/apiClient.ts` | Types + AppCheck-wrapped `generateEmbedding` export |
| Modify | `src/services/wikiLlmProvider.ts` | Add `embed` method using `generateEmbedding` |
| Create | `__tests__/wikiEmbedding.test.ts` | Integration tests: cosine ranking + fallback |

---

## Background: How the Wiki Package Uses `embed`

`expo-llm-wiki`'s `EmbeddingService` reads `llmProvider.embed` at runtime. If absent, it skips embeddings silently. If present, it calls `embed(text: string): Promise<number[]>` in two contexts:

1. **Fact storage** (`embedFact`) — called after every `ingestDocument` chunk; stores 768-float32 blob in SQLite
2. **Search queries** (`read`) — embeds the query string; computes cosine similarity against stored blobs

The same `embed` function is used for both contexts. Because the wiki package does not expose separate document/query embed hooks, this implementation defaults `taskType` to `RETRIEVAL_DOCUMENT` for all calls. This is acceptable for Clanker's use case — fact retrieval accuracy is strong with this task type, and search queries are typically short and benefit more from stored fact quality than query-side optimization.

The cloud function accepts an optional `taskType` parameter (valid values: `RETRIEVAL_DOCUMENT`, `RETRIEVAL_QUERY`, `SEMANTIC_SIMILARITY`) so future callers (e.g., a dedicated search path) can use `RETRIEVAL_QUERY` if needed.

---

## `generateEmbedding` Cloud Function

**Files:**
- `functions/src/generateEmbedding.ts`
- `functions/src/generateEmbedding.test.ts`

### Design

```typescript
// Public shape
export interface GenerateEmbeddingRequest {
  text: string;
  taskType?: string; // defaults to 'RETRIEVAL_DOCUMENT'
}

export interface GenerateEmbeddingResponse {
  embedding: number[];
}

// Testable handler
export const generateEmbeddingHandler = async (
  request: CallableRequest,
  options?: { embedder?: (text: string, taskType: string) => Promise<number[]> }
): Promise<GenerateEmbeddingResponse>
```

**Auth pattern:** Check `request.auth` only. No `userRepository` call. No subscription check. The user's wiki actor is already running behind auth by the time it calls `embed`.

**Input validation:**
- `text` must be a non-empty string, max `MAX_TEXT_LENGTH = 8_000` characters
- `taskType` defaults to `'RETRIEVAL_DOCUMENT'`; must be one of the three allowed values if provided

**Vertex AI REST call:**
```
POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}:predict
Authorization: Bearer {token}
Content-Type: application/json

{ "instances": [{ "content": text, "task_type": taskType }] }
```
Response path: `data.predictions[0].embeddings.values` → `number[]`

**Error handling:**
- Non-200 from Vertex AI → log body, throw `HttpsError("internal", "Failed to generate embedding.")`
- Any other thrown error that is not already an `HttpsError` → log, throw `HttpsError("internal", ...)`

**`onCall` config:** `region: "us-central1"`, `enforceAppCheck: true`, `invoker: "public"`, `memory: "256MiB"`

**ADC:** Module-level credential instance (`admin.credential.applicationDefault()`) so token cache survives warm invocations.

---

## Register in `index.ts`

```typescript
export {
  generateEmbedding,
} from "./generateEmbedding.js";
```

---

## Firebase Config (Native + Web)

In both `src/config/firebaseConfig.ts` and `src/config/firebaseConfig.web.ts`, following the `wikiLlmFn` / `wikiSyncFn` pattern:

```typescript
const generateEmbeddingFn = httpsCallable(functionsInstance, 'generateEmbedding')
```

Exported from both files as `generateEmbeddingFn`.

---

## `apiClient.ts`

```typescript
export interface GenerateEmbeddingRequest {
  text: string
  taskType?: string
}

export interface GenerateEmbeddingResponse {
  embedding: number[]
}

export const generateEmbedding = withAppCheck(
  generateEmbeddingCallable as Callable<GenerateEmbeddingRequest, GenerateEmbeddingResponse>,
)
```

---

## `wikiLlmProvider.ts`

```typescript
export function createWikiLlmProvider() {
  return {
    generateText: async ({ systemPrompt, userPrompt }: WikiLlmRequest): Promise<string> => {
      const result = await wikiLlm({ systemPrompt, userPrompt })
      return result.data.text
    },
    embed: async (text: string): Promise<number[]> => {
      const result = await generateEmbedding({ text, taskType: 'RETRIEVAL_DOCUMENT' })
      return result.data.embedding
    },
  }
}
```

---

## Requirements Coverage

| Requirement | Location |
|-------------|----------|
| Cloud function calls `text-embedding-004` via Vertex AI | `functions/src/generateEmbedding.ts` `defaultEmbedder` |
| Auth check only — no user bootstrap, no subscription | `request.auth` check only |
| App Check enforced | `onCall` config `enforceAppCheck: true` |
| `taskType` support (RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY) | Input validation + embedder arg |
| Returns 768-dim float array | Response shape |
| Wire up `embed` in `wikiLlmProvider` for web + native | `firebaseConfig.ts`, `firebaseConfig.web.ts`, `apiClient.ts`, `wikiLlmProvider.ts` |
| `RETRIEVAL_DOCUMENT` default for fact storage | `wikiLlmProvider.ts` `embed` closure |
| No `@google-cloud/aiplatform` SDK — REST + firebase-admin ADC | `defaultEmbedder` |
| 256MiB memory | `onCall` config |

---

## Known Limitation

The `expo-llm-wiki` package exposes a single `embed(text: string) => Promise<number[]>` interface — no separate document/query hook. Both fact storage and search queries use `RETRIEVAL_DOCUMENT`. To use `RETRIEVAL_QUERY` for search, a future update to the wiki package would be needed to expose a second embedding hook.
