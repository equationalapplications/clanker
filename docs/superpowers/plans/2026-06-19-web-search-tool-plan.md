# Web Search Tool (Google Search Grounding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Clanker's AI replies live web search via Gemini's `google_search` built-in tool, on both `functions/src/generateReply.ts` and `cloud-agent/src/agent.ts`, with grounded citations rendered in the chat UI.

**Architecture:** Migrate `generateReply.ts` from `@google-cloud/vertexai` to `@google/genai` (Vertex AI mode), add `google_search` via `core-llm-tools`' `buildAuthorizedToolsArray` with a small key-shape adapter, thread `groundingMetadata` through the existing JSON-persistence path (`message_data` column), and render it in `ChatView.tsx` via `renderCustomView`. `cloud-agent`'s ADK `LlmAgent` gets the ready-made `GOOGLE_SEARCH` tool added directly to its tools array. Both surfaces move to `gemini-3-flash-preview` (confirmed available in `us-central1`, $0.50/$3.00 per 1M tokens — Google's Gemini-3-tier pricing also drops Search grounding to $14/1,000 queries, down from $35/1,000 on Gemini 2.x).

**Tech Stack:** `@google/genai` (TS SDK, Vertex AI mode), `@equationalapplications/core-llm-tools`, `@google/adk`, `react-native-gifted-chat`, `react-native-webview` (new).

**Source spec:** `docs/superpowers/specs/2026-06-19-web-search-tool-design.md`

---

## Confirmed facts (verified during planning, not just asserted in the spec)

- `@equationalapplications/core-llm-tools@4.13.1` is published on npm and exports `buildAuthorizedToolsArray`, `googleSearchManifest`, `GeminiToolEntry`, `BuiltInToolManifest` exactly as the spec describes. `GeminiToolEntry` is `{ functionDeclarations: AgentToolSchema[] } | { google_search: Record<string, never> }`.
- `@google/genai@2.9.0` is published. `Tool.googleSearch?: GoogleSearch`, `Candidate.groundingMetadata?: GroundingMetadata`, `GroundingMetadata` has `webSearchQueries?`, `groundingChunks?`, `groundingSupports?`, `searchEntryPoint?` exactly as the spec describes. `GenerateContentConfig.systemInstruction?: ContentUnion` accepts a plain string. `GoogleGenAIOptions.vertexai?: boolean` plus `project`/`location` is the Vertex AI constructor mode.
- `@google/adk@1.2.0` re-exports `GOOGLE_SEARCH` (a `GoogleSearchTool` singleton with `name: "google_search"`) from its `common.js` barrel — same import path (`import { GOOGLE_SEARCH } from '@google/adk'`) as the `LlmAgent` import already used in `cloud-agent/src/agent.ts`.
- `gemini-3-flash-preview` is the model ID for the $0.50/$3.00 tier, available in `us-central1`.
- Google Search grounding billing for Gemini 3 models is $14 per 1,000 search queries (vs. $35/1,000 for Gemini 2.x), with 5,000 free grounding prompts/month shared across Gemini 3 models. Billing is per search query performed, not per user prompt — a single reply can trigger 0, 1, or multiple queries.
- `functions/package.json` currently pins `@equationalapplications/core-llm-tools` at `^4.10.0` (not `^4.11.0` as the spec's background section states for the root `package.json` — root is `^4.11.0`, functions is `^4.10.0`). Both get bumped to `^4.13.1` in Task 1.
- `functions/package.json` also depends on `@google/adk` (used by `functions/src/tools/time.ts`) — **not** touched by this plan; the spec's dependency-bump list only names `cloud-agent/package.json`'s `@google/adk`.

## File Structure

- Modify `package.json` (root), `functions/package.json`, `cloud-agent/package.json` — dependency bumps only.
- Modify `functions/src/generateReply.ts` — SDK migration, `google_search` tool wiring, `groundingMetadata` passthrough.
- Modify `functions/src/generateReply.test.ts` — update existing mocks to the new `GenerateTextFn` shape, add adapter + grounding tests.
- Modify `src/services/chatReplyService.ts` — `groundingMetadata` types + defensive parsing.
- Modify `__tests__/chatReplyService.test.ts` — grounding passthrough + malformed-data-drop tests.
- Modify `src/services/aiChatService.ts` — `GroundedIMessage` type, forward `groundingMetadata` into `saveAIMessage`.
- Modify `__tests__/aiChatService.test.ts` — grounding forwarding tests.
- Modify `src/components/ChatView.tsx` — citation chips + Search Suggestions `WebView` widget via `renderCustomView`.
- Modify `cloud-agent/src/agent.ts` — add `GOOGLE_SEARCH` tool, bump model literal.
- Modify `cloud-agent/src/agent.test.ts` — update tool-count/model assertions, add `google_search` presence assertion.

---

### Task 1: Dependency bumps

**Files:**
- Modify: `package.json:37`
- Modify: `functions/package.json:22,24,26`
- Modify: `cloud-agent/package.json:17`

- [ ] **Step 1: Bump `core-llm-tools` in root `package.json`**

In `package.json` line 37:

```json
    "@equationalapplications/core-llm-tools": "^4.11.0",
```

becomes:

```json
    "@equationalapplications/core-llm-tools": "^4.13.1",
```

- [ ] **Step 2: Bump `functions/package.json` dependencies**

In `functions/package.json`, change line 22:

```json
    "@equationalapplications/core-llm-tools": "^4.10.0",
```

to:

```json
    "@equationalapplications/core-llm-tools": "^4.13.1",
```

Delete line 24 entirely:

```json
    "@google-cloud/vertexai": "^1.12.0",
```

Change line 26 (now line 25 after the delete):

```json
    "@google/genai": "^1.50.1",
```

to:

```json
    "@google/genai": "^2.9.0",
```

Leave the `@google/adk` line (used by `functions/src/tools/time.ts`) untouched — it is out of scope for this feature.

- [ ] **Step 3: Bump `cloud-agent/package.json`'s `@google/adk`**

In `cloud-agent/package.json` line 17:

```json
    "@google/adk": "^1.1.0",
```

becomes:

```json
    "@google/adk": "^1.2.0",
```

- [ ] **Step 4: Install**

Run:
```bash
npm install
(cd functions && npm install)
(cd cloud-agent && npm install)
```
Expected: all three complete with no `ERESOLVE` errors. `functions/package-lock.json` and `cloud-agent/package-lock.json` are updated; `@google-cloud/vertexai` disappears from `functions/package-lock.json`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json functions/package.json functions/package-lock.json cloud-agent/package.json cloud-agent/package-lock.json
git commit -m "chore: bump core-llm-tools, @google/genai, @google/adk for web search grounding"
```

---

### Task 2: Update `generateReply.test.ts` to the new SDK response shape (TDD — write failing tests first)

This task only edits the test file. The existing implementation still returns a bare `string` from `generateText`, so after this task the test suite **will fail to build** (the new tests reference `toGenAITool`, which does not exist yet, and the new mock shapes don't match the still-`Promise<string>` `GenerateTextFn` type). That failure is expected and is fixed in Task 3.

**Files:**
- Modify: `functions/src/generateReply.test.ts`

- [ ] **Step 1: Wrap every literal-string `generateText` mock in `{ text: ... }`**

Every existing test passes a mock like `generateText: async () => "some string"`. The new `GenerateTextFn` contract (Task 3) returns `{ text: string; groundingMetadata?: GroundingMetadata }`, so each of these must become `async () => ({ text: "some string" })`. There are 14 single-line occurrences; run:

```bash
sed -i '' -E 's/generateText: async \(\) => "([^"]*)",/generateText: async () => ({ text: "\1" }),/' functions/src/generateReply.test.ts
sed -i '' -E "s/generateText: async \(\) => '([^']*)',/generateText: async () => ({ text: '\1' }),/" functions/src/generateReply.test.ts
```

Verify all 14 were rewritten:

```bash
grep -n "generateText: async () => ({" functions/src/generateReply.test.ts | wc -l
```
Expected: `14`

- [ ] **Step 2: Fix the one multi-line mock that returns a string**

In the "allows intro requests with structured payload to proceed" test, find:

```ts
      {
        generateText: async () => {
          generateTextCalled = true;
          return 'intro response';
        },
      }
```

Change `return 'intro response';` to:

```ts
          return { text: 'intro response' };
```

The three mocks that `throw` instead of returning (`"generateText should not be invoked..."`, `"model down"`, `HttpsError("failed-precondition", "Vertex AI unavailable")`) need no change — they never reach a `return` statement, so their inferred return type is compatible with any `Promise<...>`.

- [ ] **Step 3: Add `toGenAITool` adapter import and unit tests**

At the top of `functions/src/generateReply.test.ts`, change:

```ts
import {generateReplyHandler} from "./generateReply.js";
```

to:

```ts
import {generateReplyHandler, toGenAITool} from "./generateReply.js";
```

Add these tests anywhere after the existing imports/helpers (e.g. right after the `withServiceMocks` helper, before the first `test(...)` call):

```ts
test("toGenAITool maps a google_search entry to the camelCase googleSearch field", () => {
  const result = toGenAITool({ google_search: {} } as never);
  assert.deepEqual(result, { googleSearch: {} });
});

test("toGenAITool passes functionDeclarations entries through", () => {
  const functionDeclarations = [
    { name: "get_current_time", description: "Returns the current time." },
  ];
  const result = toGenAITool({ functionDeclarations } as never);
  assert.deepEqual(result, { functionDeclarations });
});

test("toGenAITool throws on an unrecognized tool entry", () => {
  assert.throws(
    () => toGenAITool({} as never),
    /Unsupported tool entry/
  );
});
```

- [ ] **Step 4: Add grounding-passthrough tests on the handler**

Add these two tests near the end of the file (after the "still returns reply when unsyncedHistory DB insert fails" test):

```ts
test("generateReplyHandler forwards groundingMetadata when the model grounds its reply", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const groundingMetadata = {
      webSearchQueries: ['weather in Tokyo'],
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
    };

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('what is the weather in Tokyo'),
      } as never,
      {
        generateText: async () => ({ text: 'It is sunny in Tokyo.', groundingMetadata }),
      }
    );

    assert.equal(result.reply, 'It is sunny in Tokyo.');
    assert.deepEqual(result.groundingMetadata, groundingMetadata);
  });
});

test("generateReplyHandler omits groundingMetadata when the model does not ground its reply", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const result = await generateReplyHandler(
      {
        auth,
        data: buildStructuredRequestData('hello'),
      } as never,
      {
        generateText: async () => ({ text: 'hi there' }),
      }
    );

    assert.equal(result.reply, 'hi there');
    assert.equal(result.groundingMetadata, undefined);
  });
});
```

- [ ] **Step 5: Confirm the build fails (expected, drives Task 3)**

Run:
```bash
cd functions && npm run build
```
Expected: `FAIL` — TypeScript errors referencing `toGenAITool` not exported from `./generateReply.js`, and `groundingMetadata` not a property of `GenerateReplyResponse`. This confirms the tests are correctly driving the not-yet-written implementation.

- [ ] **Step 6: Commit**

```bash
git add functions/src/generateReply.test.ts
git commit -m "test: drive generateReply Google Search grounding migration with failing tests"
```

---

### Task 3: Migrate `generateReply.ts` to `@google/genai` and wire `google_search`

This task makes Task 2's tests pass.

**Files:**
- Modify: `functions/src/generateReply.ts:1-18,140-300,440-470,534-567`

- [ ] **Step 1: Replace the Vertex AI interfaces and imports with `@google/genai` + `core-llm-tools`**

Change the import block at the top of the file (lines 1-12):

```ts
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { and, eq } from "drizzle-orm";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService } from "./services/creditService.js";
import { buildUsageSnapshotForUser } from "./usageSnapshot.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";
import { getDb } from "./db/cloudSql.js";
import { characters, messages } from "./db/schema.js";
```

to:

```ts
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { and, eq } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import type { Content, GroundingMetadata, Tool } from "@google/genai";
import { buildAuthorizedToolsArray, googleSearchManifest } from "@equationalapplications/core-llm-tools";
import type { GeminiToolEntry } from "@equationalapplications/core-llm-tools";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { creditService } from "./services/creditService.js";
import { buildUsageSnapshotForUser } from "./usageSnapshot.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";
import { getDb } from "./db/cloudSql.js";
import { characters, messages } from "./db/schema.js";
```

- [ ] **Step 2: Update `DEFAULT_MODEL`**

Change line 14:

```ts
const DEFAULT_MODEL = "gemini-2.5-flash";
```

to:

```ts
const DEFAULT_MODEL = "gemini-3-flash-preview";
```

- [ ] **Step 3: Add `groundingMetadata` to `GenerateReplyResponse`**

Change (lines 141-149):

```ts
export interface GenerateReplyResponse {
  reply: string;
  creditsSpent: number;
  remainingCredits: number | undefined;
  planTier: string | null;
  planStatus: 'active' | 'cancelled' | 'expired' | null;
  verifiedAt: string;
  messageId?: string;
}
```

to:

```ts
export interface GenerateReplyResponse {
  reply: string;
  creditsSpent: number;
  remainingCredits: number | undefined;
  planTier: string | null;
  planStatus: 'active' | 'cancelled' | 'expired' | null;
  verifiedAt: string;
  messageId?: string;
  groundingMetadata?: GroundingMetadata;
}
```

- [ ] **Step 4: Change `GenerateTextFn`'s return type**

Change (lines 151-154):

```ts
type GenerateTextFn = (input: {
  contents: unknown[];
  systemInstruction: string;
}) => Promise<string>;
```

to:

```ts
type GenerateTextFn = (input: {
  contents: unknown[];
  systemInstruction: string;
}) => Promise<{ text: string; groundingMetadata?: GroundingMetadata }>;
```

- [ ] **Step 5: Delete the now-unused Vertex AI interfaces**

Delete lines 163-203 entirely (`CandidatePart`, `Candidate`, `GenerateContentInput`, `GenerateContentResult`, `GenerativeModelLike`, `VertexAILike`, `VertexAIConstructor`, `VertexAIModule`) — i.e. everything from:

```ts
interface CandidatePart {
```

through:

```ts
interface VertexAIModule {
  VertexAI: VertexAIConstructor;
}
```

`@google/genai`'s own `GenerateContentResponse`/`Candidate`/`Content`/`Part` types replace all of these.

- [ ] **Step 6: Replace `getModel()` with `getGenAIClient()`, and add `toGenAITool`**

Replace (the block spanning the old `let textGenerator...` through the end of `getModel()`, originally lines 223-282):

```ts
let textGenerator: GenerateTextFn | undefined;
let modelPromise: Promise<GenerativeModelLike> | undefined;

async function getModel(): Promise<GenerativeModelLike> {
  if (modelPromise) {
    return modelPromise;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI chat response generation."
    );
  }

  modelPromise = (async () => {
    try {
      // Avoid hard compile-time dependency resolution so typecheck still runs when
      // function deps are not installed in the current environment.
      const moduleName = "@google-cloud/vertexai";
      const vertexModule = await import(moduleName) as VertexAIModule;
      const vertex = new vertexModule.VertexAI({project, location: DEFAULT_REGION});

      return vertex.getGenerativeModel({
        model: DEFAULT_MODEL,
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch (error: unknown) {
      modelPromise = undefined;

      const message = error instanceof Error ? error.message : String(error);
      const missingVertexModule =
        (error instanceof Error &&
          ("code" in error && error.code === "MODULE_NOT_FOUND")) ||
        message.includes("@google-cloud/vertexai");

      if (missingVertexModule) {
        throw new HttpsError(
          "failed-precondition",
          "The @google-cloud/vertexai package is not available. " +
            "Ensure it is installed and deployed with this function."
        );
      }

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        `Failed to initialize Vertex AI model: ${message}`
      );
    }
  })();

  return modelPromise;
}
```

with:

```ts
let textGenerator: GenerateTextFn | undefined;
let genAIClient: GoogleGenAI | undefined;

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }

  const project = getProjectId();
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing GCLOUD_PROJECT for Vertex AI chat response generation."
    );
  }

  genAIClient = new GoogleGenAI({ vertexai: true, project, location: DEFAULT_REGION });
  return genAIClient;
}

export function toGenAITool(entry: GeminiToolEntry): Tool {
  if ('google_search' in entry) {
    return { googleSearch: {} };
  }
  if ('functionDeclarations' in entry) {
    return { functionDeclarations: entry.functionDeclarations as Tool['functionDeclarations'] };
  }
  throw new Error('Unsupported tool entry');
}
```

- [ ] **Step 7: Rewrite `getTextGenerator()` against the new client**

Replace (originally lines 284-310):

```ts
function getTextGenerator(): GenerateTextFn {
  if (textGenerator) {
    return textGenerator;
  }

  textGenerator = async (input: {
    contents: unknown[];
    systemInstruction: string;
  }): Promise<string> => {
    const model = await getModel();
    const result = await model.generateContent({
      contents: input.contents,
      systemInstruction: input.systemInstruction,
    });
    const candidates = result.response.candidates ?? [];

    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      const text = parts
        .map((part: CandidatePart) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();

      if (text.length > 0) {
        return text;
      }
    }

    throw new HttpsError("internal", "Vertex AI returned an empty response.");
  };

  return textGenerator;
}
```

with:

```ts
function getTextGenerator(): GenerateTextFn {
  if (textGenerator) {
    return textGenerator;
  }

  textGenerator = async (input: {
    contents: unknown[];
    systemInstruction: string;
  }) => {
    const ai = getGenAIClient();
    const tools = buildAuthorizedToolsArray([googleSearchManifest], []).map(toGenAITool);

    const result = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: input.contents as Content[],
      config: {
        systemInstruction: input.systemInstruction,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        tools,
      },
    });

    const candidates = result.candidates ?? [];

    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      const text = parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();

      if (text.length > 0) {
        return { text, groundingMetadata: candidate.groundingMetadata };
      }
    }

    throw new HttpsError("internal", "Model returned an empty response.");
  };

  return textGenerator;
}
```

- [ ] **Step 8: Thread the `{ text, groundingMetadata }` result through the handler**

Change (lines 546-567):

```ts
    reply = (
      await generateText({
        contents: contents ?? [],
        systemInstruction: systemInstruction ?? '',
      })
    ).trim();
    if (!reply) {
      throw new HttpsError("internal", "Model returned an empty chat response.");
    }

    const usageSnapshot = await buildUsageSnapshotForUser(
      user.id,
      subscriptionService,
      'generateReply'
    );

    return {
      reply,
      creditsSpent: 1,
      remainingCredits,
      ...usageSnapshot,
    };
```

to:

```ts
    const generated = await generateText({
      contents: contents ?? [],
      systemInstruction: systemInstruction ?? '',
    });
    reply = generated.text.trim();
    if (!reply) {
      throw new HttpsError("internal", "Model returned an empty chat response.");
    }

    const usageSnapshot = await buildUsageSnapshotForUser(
      user.id,
      subscriptionService,
      'generateReply'
    );

    return {
      reply,
      creditsSpent: 1,
      remainingCredits,
      groundingMetadata: generated.groundingMetadata,
      ...usageSnapshot,
    };
```

- [ ] **Step 9: Build and run tests**

Run:
```bash
cd functions && npm run build && npm test
```
Expected: build succeeds, all tests in `generateReply.test.ts` pass, including the three `toGenAITool` tests and the two grounding-passthrough tests added in Task 2.

- [ ] **Step 10: Typecheck**

Run:
```bash
cd functions && npm run typecheck
```
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add functions/src/generateReply.ts
git commit -m "feat: migrate generateReply to @google/genai with Google Search grounding"
```

---

### Task 4: `chatReplyService.ts` — type and defensively parse `groundingMetadata`

**Files:**
- Modify: `src/services/chatReplyService.ts:1,38,46-50`
- Test: `__tests__/chatReplyService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/chatReplyService.test.ts`, inside the top-level `describe('generateChatReply', ...)` block, after the existing `it('trims whitespace-padded verifiedAt...')` test and before the `describe('mock auth branch...)` block:

```ts
  it('parses and forwards groundingMetadata when present', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Grounded reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: {
          webSearchQueries: ['weather in Tokyo'],
          groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
          searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
        },
      },
    })

    const resultPromise = generateChatReply({ prompt: 'weather', referenceId: 'abc' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata).toEqual({
      webSearchQueries: ['weather in Tokyo'],
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
      searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
    })
  })

  it('drops malformed groundingMetadata instead of throwing', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: 'not-an-object',
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata).toBeUndefined()
  })

  it('drops groundingMetadata when present but empty of recognized fields', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: 'Reply',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        groundingMetadata: { unrelatedField: 123 },
      },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.groundingMetadata).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm test -- chatReplyService.test.ts
```
Expected: `FAIL` — `result.groundingMetadata` is `undefined` is actually true today for the wrong reason (no such field exists yet), but the first new test ("parses and forwards groundingMetadata when present") fails because `result.groundingMetadata` is `undefined` instead of the expected object.

- [ ] **Step 3: Add the type and parser to `chatReplyService.ts`**

Change the top import (line 1):

```ts
import { GoogleGenAI } from '@google/genai'
```

to:

```ts
import { GoogleGenAI } from '@google/genai'
import type { GroundingMetadata } from '@google/genai'
```

Change `GenerateReplyCallableResponse` and `GenerateChatReplyResult` (originally lines 38-50):

```ts
interface GenerateReplyCallableResponse {
  reply: string
  remainingCredits?: number | null
  planTier?: string | null
  planStatus?: 'active' | 'cancelled' | 'expired' | null
  verifiedAt?: string
}

export interface GenerateChatReplyResult {
  reply: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
}
```

to:

```ts
interface GenerateReplyCallableResponse {
  reply: string
  remainingCredits?: number | null
  planTier?: string | null
  planStatus?: 'active' | 'cancelled' | 'expired' | null
  verifiedAt?: string
  groundingMetadata?: unknown
}

export interface GenerateChatReplyResult {
  reply: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
  groundingMetadata?: GroundingMetadata
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseGroundingMetadata(raw: unknown): GroundingMetadata | undefined {
  if (!isPlainObject(raw)) {
    return undefined
  }

  const metadata: GroundingMetadata = {}

  if (Array.isArray(raw.webSearchQueries) && raw.webSearchQueries.every((q) => typeof q === 'string')) {
    metadata.webSearchQueries = raw.webSearchQueries as string[]
  }

  if (Array.isArray(raw.groundingChunks)) {
    metadata.groundingChunks = raw.groundingChunks as GroundingMetadata['groundingChunks']
  }

  if (Array.isArray(raw.groundingSupports)) {
    metadata.groundingSupports = raw.groundingSupports as GroundingMetadata['groundingSupports']
  }

  if (
    isPlainObject(raw.searchEntryPoint) &&
    typeof raw.searchEntryPoint.renderedContent === 'string'
  ) {
    metadata.searchEntryPoint = raw.searchEntryPoint as GroundingMetadata['searchEntryPoint']
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}
```

- [ ] **Step 4: Forward the parsed metadata from `generateChatReply`'s callable-response branch**

Find the closing return statement of `generateChatReply` (after `const data = result.data as GenerateReplyCallableResponse` and the `verifiedAt` validation):

```ts
  return {
    reply: data.reply.trim(),
    remainingCredits:
      typeof data.remainingCredits === 'number' && Number.isFinite(data.remainingCredits)
        ? data.remainingCredits
        : null,
    planTier: typeof data.planTier === 'string' ? data.planTier : null,
    planStatus:
      data.planStatus === 'active' || data.planStatus === 'cancelled' || data.planStatus === 'expired'
        ? data.planStatus
        : null,
    verifiedAt,
  }
```

to:

```ts
  return {
    reply: data.reply.trim(),
    remainingCredits:
      typeof data.remainingCredits === 'number' && Number.isFinite(data.remainingCredits)
        ? data.remainingCredits
        : null,
    planTier: typeof data.planTier === 'string' ? data.planTier : null,
    planStatus:
      data.planStatus === 'active' || data.planStatus === 'cancelled' || data.planStatus === 'expired'
        ? data.planStatus
        : null,
    verifiedAt,
    groundingMetadata: parseGroundingMetadata(data.groundingMetadata),
  }
```

(The mock-auth/edge-agent branch and the escalated cloud-agent branch are unaffected — neither produces `groundingMetadata`, so callers of those paths simply get `undefined`, same as today's implicit absence.)

- [ ] **Step 5: Run the tests**

Run:
```bash
npm test -- chatReplyService.test.ts
```
Expected: `PASS`, all tests including the 3 new ones.

- [ ] **Step 6: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/chatReplyService.ts __tests__/chatReplyService.test.ts
git commit -m "feat: parse and forward groundingMetadata in chatReplyService"
```

---

### Task 5: `aiChatService.ts` — forward `groundingMetadata` into `saveAIMessage`

**Files:**
- Modify: `src/services/aiChatService.ts:1-17,~310-330`
- Test: `__tests__/aiChatService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/aiChatService.test.ts`, inside `describe('sendMessageWithAIResponse', ...)`, after the existing `mockSaveAIMessage.mockImplementation` setup in `beforeEach` (i.e. as new `it(...)` blocks alongside the existing ones):

```ts
  it('forwards groundingMetadata to saveAIMessage when the AI response includes it', async () => {
    const groundingMetadata = {
      webSearchQueries: ['weather in Tokyo'],
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
    }
    mockGenerateChatReply.mockResolvedValue({
      reply: 'It is sunny in Tokyo.',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
      groundingMetadata,
    })

    await sendMessageWithAIResponse(
      {
        _id: 'msg-grounded',
        text: 'What is the weather in Tokyo?',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any,
      {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'calm',
        emotions: 'encouraging',
        context: 'friendly coach',
      },
      'user-1',
      [] as any,
    )

    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'It is sunny in Tokyo.',
      expect.any(String),
      expect.objectContaining({ groundingMetadata }),
      expect.any(Number),
    )
  })

  it('omits groundingMetadata from saveAIMessage when the AI response has none', async () => {
    mockGenerateChatReply.mockResolvedValue({
      reply: 'Hi there.',
      remainingCredits: null,
      planTier: 'monthly_20',
      planStatus: 'active',
      verifiedAt: '2026-04-27T00:00:00.000Z',
    })

    await sendMessageWithAIResponse(
      {
        _id: 'msg-plain',
        text: 'Hello',
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any,
      {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'calm',
        emotions: 'encouraging',
        context: 'friendly coach',
      },
      'user-1',
      [] as any,
    )

    const additionalDataArg = mockSaveAIMessage.mock.calls[0][4]
    expect(additionalDataArg).not.toHaveProperty('groundingMetadata')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm test -- aiChatService.test.ts
```
Expected: `FAIL` on "forwards groundingMetadata to saveAIMessage when the AI response includes it" — `saveAIMessage` is called without a `groundingMetadata` key.

- [ ] **Step 3: Add `GroundedIMessage` and wire it into `sendMessageWithAIResponse`**

Change the top imports of `src/services/aiChatService.ts`:

```ts
import { sendMessage } from '~/services/messageService'
import {
  getMessageCount,
  getMessagesForContextSummary,
  pruneMessagesForCharacter,
  saveAIMessage,
} from '~/database/messageDatabase'
import { getCharacter as getLocalCharacter, updateCharacter } from '~/database/characterDatabase'
import { generateChatReply, type GenerateChatReplyResult } from '~/services/chatReplyService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { summarizeText } from '~/services/summarizeTextService'
import type { UsageSnapshotPayload } from '~/services/usageSnapshot'
import { onlineManager } from '@tanstack/react-query'
import { IMessage } from 'react-native-gifted-chat'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
import type { SyncMessage } from '~/services/syncMessage'
```

to:

```ts
import { sendMessage } from '~/services/messageService'
import {
  getMessageCount,
  getMessagesForContextSummary,
  pruneMessagesForCharacter,
  saveAIMessage,
} from '~/database/messageDatabase'
import { getCharacter as getLocalCharacter, updateCharacter } from '~/database/characterDatabase'
import { generateChatReply, type GenerateChatReplyResult } from '~/services/chatReplyService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { summarizeText } from '~/services/summarizeTextService'
import type { UsageSnapshotPayload } from '~/services/usageSnapshot'
import { onlineManager } from '@tanstack/react-query'
import { IMessage } from 'react-native-gifted-chat'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
import type { SyncMessage } from '~/services/syncMessage'
import type { GroundingMetadata } from '@google/genai'

export type GroundedIMessage = IMessage & { groundingMetadata?: GroundingMetadata }
```

In `sendMessageWithAIResponse`, find:

```ts
    // 5. Save AI response to local database (mark as synced — cloud reply is immediately synced)
    const savedAIMessage = await saveAIMessage(character.id, userId, aiResponse.reply, aiResponseId, {
      user: {
        _id: character.id, // The character is responding
        name: character.name,
        avatar: character.appearance || undefined,
      },
    }, Date.now())
```

and replace it with:

```ts
    // 5. Save AI response to local database (mark as synced — cloud reply is immediately synced)
    const aiMessageData: Partial<GroundedIMessage> = {
      user: {
        _id: character.id, // The character is responding
        name: character.name,
        avatar: character.appearance || undefined,
      },
    }
    if (aiResponse.groundingMetadata) {
      aiMessageData.groundingMetadata = aiResponse.groundingMetadata
    }

    const savedAIMessage = await saveAIMessage(character.id, userId, aiResponse.reply, aiResponseId, aiMessageData, Date.now())
```

- [ ] **Step 4: Run the tests**

Run:
```bash
npm test -- aiChatService.test.ts
```
Expected: `PASS`, all tests including the 2 new ones.

- [ ] **Step 5: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/aiChatService.ts __tests__/aiChatService.test.ts
git commit -m "feat: forward groundingMetadata into saveAIMessage via GroundedIMessage"
```

---

### Task 6: `ChatView.tsx` — citation chips + Search Suggestions widget

This is UI-only work. Per the spec's testing strategy, there is no automated visual test — verify manually in the simulator after implementing.

**Files:**
- Modify: `package.json` (new dependency)
- Modify: `src/components/ChatView.tsx`

- [ ] **Step 1: Add the `react-native-webview` dependency**

Run (Expo resolves the SDK-56-compatible version automatically):
```bash
npx expo install react-native-webview
```
Expected: `package.json` gains a `react-native-webview` entry; `npm install` runs as part of `expo install`.

- [ ] **Step 2: Import what's needed**

Change the top of `src/components/ChatView.tsx`:

```tsx
import React, { useCallback } from 'react'
import { router } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import { View, Text as RNText, StyleSheet, Platform, TouchableOpacity } from 'react-native'
import { GiftedChat, Bubble, InputToolbar, Send, MessageText } from 'react-native-gifted-chat'
import type { IMessage, User, ComposerProps, SendProps, InputToolbarProps, MessageTextProps } from 'react-native-gifted-chat'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useMessages'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { useUserCredits } from '~/hooks/useUserCredits'
import CharacterAvatar from '~/components/CharacterAvatar'
import ChatComposer from '~/components/ChatComposer'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
```

to:

```tsx
import React, { useCallback } from 'react'
import { router } from 'expo-router'
import { useNavigation } from 'expo-router/react-navigation'
import { View, Text as RNText, StyleSheet, Platform, TouchableOpacity, Linking } from 'react-native'
import { GiftedChat, Bubble, InputToolbar, Send, MessageText } from 'react-native-gifted-chat'
import type { IMessage, User, ComposerProps, SendProps, InputToolbarProps, MessageTextProps } from 'react-native-gifted-chat'
import { WebView } from 'react-native-webview'
import { useSelector } from '@xstate/react'
import { useCharacter } from '~/hooks/useCharacters'
import { useChatMessages } from '~/hooks/useMessages'
import { useAIChat } from '~/hooks/useAIChat'
import { Text, useTheme, Avatar } from 'react-native-paper'
import { useAuthMachine } from '~/hooks/useMachines'
import { useUserCredits } from '~/hooks/useUserCredits'
import CharacterAvatar from '~/components/CharacterAvatar'
import ChatComposer from '~/components/ChatComposer'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import type { GroundedIMessage } from '~/services/aiChatService'
```

- [ ] **Step 3: Add `renderCustomView`**

Add this `useCallback` in `ChatView` right after `renderComposer` (after the closing `[characterId, currentUserId],\n  )` of `renderComposer`):

```tsx
  const renderCustomView = useCallback(
    (props: { currentMessage?: GroundedIMessage }) => {
      const metadata = props.currentMessage?.groundingMetadata
      if (!metadata) {
        return null
      }

      const chunks = metadata.groundingChunks ?? []
      const renderedContent = metadata.searchEntryPoint?.renderedContent

      if (chunks.length === 0 && !renderedContent) {
        return null
      }

      return (
        <View style={styles.groundingContainer}>
          {chunks.length > 0 && (
            <View
              style={styles.citationRow}
              accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}
              accessibilityLabel="Search sources"
            >
              {chunks.map((chunk, index) => {
                const uri = chunk.web?.uri
                const title = chunk.web?.title ?? uri
                if (!uri || !title) {
                  return null
                }
                return (
                  <TouchableOpacity
                    key={`${uri}-${index}`}
                    style={styles.citationChip}
                    onPress={() => Linking.openURL(uri)}
                    accessibilityRole="link"
                    accessibilityLabel={title}
                  >
                    <RNText style={styles.citationChipText} numberOfLines={1}>
                      {title}
                    </RNText>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
          {renderedContent && (
            <WebView
              originWhitelist={['*']}
              source={{ html: renderedContent }}
              style={styles.searchSuggestions}
              scrollEnabled={false}
            />
          )}
        </View>
      )
    },
    [],
  )
```

- [ ] **Step 4: Wire `renderCustomView` onto `GiftedChat`**

In the `<GiftedChat ... />` element, add `renderCustomView` and `isCustomViewBottom` alongside the existing props:

```tsx
        <GiftedChat
          messages={messages}
          onSend={handleSend}
          user={chatUser}
          renderComposer={renderComposer}
          renderBubble={renderBubble}
          renderInputToolbar={renderInputToolbar}
          renderSend={renderSend}
          renderCustomView={renderCustomView}
          isCustomViewBottom
          renderAvatarOnTop
          messagesContainerStyle={styles.messagesContainer}
          minInputToolbarHeight={56}
```

(leave the rest of the props, including `renderAvatar`, unchanged.)

- [ ] **Step 5: Add styles**

In the `StyleSheet.create({...})` block at the bottom of the file, add these keys alongside the existing ones:

```ts
  groundingContainer: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 6,
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  citationChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    maxWidth: 220,
  },
  citationChipText: {
    fontSize: 12,
  },
  searchSuggestions: {
    height: 44,
    backgroundColor: 'transparent',
  },
```

- [ ] **Step 6: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 7: Manual verification**

Use the `run` skill (or `npm run ios` / `npm run android` / `npm run web`) to launch the app, open a chat with a character, and send a message that should trigger Google Search grounding (e.g. "what's the weather in Tokyo right now?"). Confirm:
- Citation chips render below the AI reply and open the source URL when tapped.
- The Search Suggestions `WebView` renders below the chips when `searchEntryPoint.renderedContent` is present.
- Replies without grounding render exactly as before (no empty gap, no `renderCustomView` output).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/components/ChatView.tsx
git commit -m "feat: render Google Search citations and Search Suggestions widget in ChatView"
```

---

### Task 7: `cloud-agent` — add `GOOGLE_SEARCH` to the ADK agent

**Files:**
- Modify: `cloud-agent/src/agent.ts`
- Modify: `cloud-agent/src/agent.test.ts`

- [ ] **Step 1: Update the failing assertions first**

In `cloud-agent/src/agent.test.ts`, change:

```ts
test('buildAgent: returns LlmAgent with 10 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.tools.length, 10)
})
```

to:

```ts
test('buildAgent: returns LlmAgent with 11 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.tools.length, 11)
})
```

Change:

```ts
test('buildAgent: registers all required tool names', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  const names = agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('create_task'), 'missing create_task')
  assert.ok(names.includes('list_tasks'), 'missing list_tasks')
  assert.ok(names.includes('wiki_read'), 'missing wiki_read')
  assert.ok(names.includes('wiki_write'), 'missing wiki_write')
  assert.ok(names.includes('get_current_time'), 'missing get_current_time')
  assert.ok(names.includes('update_task'), 'missing update_task')
  assert.ok(names.includes('complete_task'), 'missing complete_task')
  assert.ok(names.includes('delete_task'), 'missing delete_task')
  assert.ok(names.includes('document_search'), 'missing document_search')
  assert.ok(names.includes('set_reminder'), 'missing set_reminder')
})
```

to:

```ts
test('buildAgent: registers all required tool names', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  const names = agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('create_task'), 'missing create_task')
  assert.ok(names.includes('list_tasks'), 'missing list_tasks')
  assert.ok(names.includes('wiki_read'), 'missing wiki_read')
  assert.ok(names.includes('wiki_write'), 'missing wiki_write')
  assert.ok(names.includes('get_current_time'), 'missing get_current_time')
  assert.ok(names.includes('update_task'), 'missing update_task')
  assert.ok(names.includes('complete_task'), 'missing complete_task')
  assert.ok(names.includes('delete_task'), 'missing delete_task')
  assert.ok(names.includes('document_search'), 'missing document_search')
  assert.ok(names.includes('set_reminder'), 'missing set_reminder')
  assert.ok(names.includes('google_search'), 'missing google_search')
})
```

Change:

```ts
test('buildAgent: model is gemini-2.5-flash', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.model, 'gemini-2.5-flash')
})
```

to:

```ts
test('buildAgent: model is gemini-3-flash-preview', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.model, 'gemini-3-flash-preview')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
cd cloud-agent && npm run build && npm test
```
Expected: `FAIL` — `agent.tools.length` is `10`, not `11`; `agent.model` is `'gemini-2.5-flash'`, not `'gemini-3-flash-preview'`.

- [ ] **Step 3: Wire `GOOGLE_SEARCH` and bump the model**

Change `cloud-agent/src/agent.ts`:

```ts
import { LlmAgent } from '@google/adk'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import { getCurrentTimeTool } from './tools/time.js'
import { documentSearchTool } from './tools/documents.js'
import { setReminderTool } from './tools/reminders.js'
import type { DrizzleClient } from './db/client.js'
export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-2.5-flash',
    instruction: systemInstruction,
    tools: [
      getCurrentTimeTool(timezone),
      wikiReadTool(db, userId, characterId, embed),
      wikiWriteTool(db, userId, characterId, embed),
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      updateTaskTool(db, userId, characterId),
      completeTaskTool(db, userId, characterId),
      deleteTaskTool(db, userId, characterId),
      documentSearchTool(db, userId, characterId),
      setReminderTool(db, userId, characterId),
    ],
  })
}
```

to:

```ts
import { LlmAgent, GOOGLE_SEARCH } from '@google/adk'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import { getCurrentTimeTool } from './tools/time.js'
import { documentSearchTool } from './tools/documents.js'
import { setReminderTool } from './tools/reminders.js'
import type { DrizzleClient } from './db/client.js'
export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
): LlmAgent {
  return new LlmAgent({
    name: 'clanker-cloud-agent',
    model: 'gemini-3-flash-preview',
    instruction: systemInstruction,
    tools: [
      getCurrentTimeTool(timezone),
      wikiReadTool(db, userId, characterId, embed),
      wikiWriteTool(db, userId, characterId, embed),
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      updateTaskTool(db, userId, characterId),
      completeTaskTool(db, userId, characterId),
      deleteTaskTool(db, userId, characterId),
      documentSearchTool(db, userId, characterId),
      setReminderTool(db, userId, characterId),
      GOOGLE_SEARCH,
    ],
  })
}
```

- [ ] **Step 4: Run the tests**

Run:
```bash
cd cloud-agent && npm run build && npm test
```
Expected: `PASS`, all tests including the updated tool-count/name/model assertions.

- [ ] **Step 5: Typecheck**

Run:
```bash
cd cloud-agent && npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Manual smoke test against live Vertex AI**

`agent.test.ts` only constructs the `LlmAgent` and inspects its `tools`/`model` fields — it does not execute a real model call. Before considering this feature deploy-ready, run the cloud-agent locally against real Vertex AI credentials (`cd cloud-agent && npm run dev`) and send a request through `/agent/run` that requires both a custom tool (e.g. `set_reminder`) and a live web fact (e.g. "what's today's top tech headline, and also remind me to check it at 5pm"). Confirm the agent responds successfully without an ADK error about mixing built-in and custom tools, and that this matches the spec's note that Gemini 3 officially supports mixing `GOOGLE_SEARCH` with function-calling tools.

- [ ] **Step 7: Commit**

```bash
git add cloud-agent/src/agent.ts cloud-agent/src/agent.test.ts
git commit -m "feat: add Google Search grounding tool to the cloud-agent ADK agent"
```

---

## Risks / open items (carried from the spec, still open after this plan)

- **Per-query grounding billing**: confirmed at $14/1,000 search queries for Gemini 3 (vs. $35/1,000 for Gemini 2.x), with 5,000 free grounding prompts/month. This is a per-search-query charge, not per-reply — a single `generateReply` call can trigger 0, 1, or several queries. Whether this changes the economics of `creditService`'s flat 1-credit-per-reply charge enough to need a price/credit adjustment is a product decision outside this plan's scope; monitor Vertex AI billing after rollout.
- **`gemini-3-flash-preview` is a preview model ID** — Google may rename or retire preview model IDs. If `us-central1` availability or the model ID changes before this ships, update `DEFAULT_MODEL` in `functions/src/generateReply.ts` and the `model:` literal in `cloud-agent/src/agent.ts` (both call sites are listed in Tasks 3 and 7 above).
