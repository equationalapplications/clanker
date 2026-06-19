# Web Search Tool (Google Search Grounding) — Design

**Status:** Implemented

## Goal

Give Clanker's AI replies access to live web search via Gemini's built-in
`google_search` tool, with grounded citations surfaced in the chat UI, across
both tool-calling surfaces in the codebase:

1. `functions/src/generateReply.ts` — the one-shot Vertex/GenAI call used for
   structured chat replies (no tools wired in today).
2. `cloud-agent/src/agent.ts` — the agentic Google ADK `LlmAgent` loop (already
   has 10 custom function tools: tasks, wiki, reminders, document search).

## Background / facts established during brainstorming

- `@equationalapplications/core-llm-tools` is pinned at `^4.11.0` in this repo,
  which only exports `buildAuthorizedSchemaArray`, `escalateToCloudManifest`,
  `getCurrentTimeManifest`. Version `4.13.1` (latest published) adds
  `buildAuthorizedToolsArray`, `googleSearchManifest`, and the
  `GeminiToolEntry`/`BuiltInToolManifest` types needed for this feature.
- `functions/src/generateReply.ts` currently uses `@google-cloud/vertexai`
  (`^1.12.0`, latest published). That SDK's `Tool` union
  (`FunctionDeclarationsTool | RetrievalTool | GoogleSearchRetrievalTool`) only
  supports the legacy `googleSearchRetrieval` grounding shape — it has no
  `google_search` built-in tool field and will not gain one (no newer version
  exists). `@google/genai` (already a frontend dep, and already in
  `functions/package.json` at `^1.50.1`) has full typed `googleSearch` /
  `groundingMetadata` support and is Google's current unified SDK.
- `core-llm-tools`' built-in tool entries use the wire-format key
  `google_search` (snake_case). `@google/genai`'s `Tool` type expects the
  camelCase field `googleSearch`. These do not match structurally — a small
  adapter is required, not a direct pass-through.
- `@google/genai` supports Vertex AI mode (`{ vertexai: true, project,
  location }`), the same ADC-based auth `generateReply.ts` already uses — no
  new credentials needed for the SDK swap.
- `@google/adk` (cloud-agent, `^1.1.0`) already ships a ready-made
  `GOOGLE_SEARCH` built-in tool singleton — no adapter needed on that surface.
- React Native GiftedChat (as used in `ChatView.tsx`) supports
  `renderCustomView` + `isCustomViewBottom`, which is the right hook for
  rendering citations/widget below message text. No HTML/WebView renderer is
  currently installed in the app.
- `saveAIMessage` already persists arbitrary extra `IMessage` fields as JSON
  (`message_data` column) and rehydrates them via `toGiftedChatMessage` — this
  is the existing mechanism for carrying `groundingMetadata` through local
  storage.

## Scope

**In scope:**
- Google Search grounding on both `generateReply.ts` and `cloud-agent`'s ADK
  agent.
- Migrating `functions/src/generateReply.ts` off `@google-cloud/vertexai` onto
  `@google/genai`.
- Dependency bumps: `core-llm-tools` → `^4.13.1` (root + functions),
  `@google/genai` → `^2.9.0` (functions, to match root's resolved version —
  root declares `^2.8.0` but resolves to `2.9.0`), `@google/adk` → `^1.2.0`
  (cloud-agent).
- Migrating the model used by `generateReply.ts` and `cloud-agent/src/agent.ts`
  from `gemini-2.5-flash` to a Gemini 3-family model, to get official support
  for mixing built-in tools with custom function declarations and per-query
  grounding billing.
- Citation + Search Suggestions widget rendering in the chat UI
  (`ChatView.tsx`), incl. a new `react-native-webview` dependency.

**Explicitly out of scope:**
- OKF export (`formatOkfBundle`, `@equationalapplications/core-okf`) — separate
  future spec.
- `@equationalapplications/expo-llm-wiki` version bump — unrelated to this
  feature.
- Any dependency bumps beyond the ones listed above.

## Design

### 1. Package + SDK changes

- Bump `@equationalapplications/core-llm-tools` to `^4.13.1` in root
  `package.json` and `functions/package.json`.
- Bump `@google/genai` in `functions/package.json` from `^1.50.1` to `^2.9.0`
  (root declares `^2.8.0` but resolves to `2.9.0` — pin functions to `^2.9.0`
  explicitly for type symmetry, since `groundingMetadata` types are still
  evolving across releases).
- Bump `@google/adk` in `cloud-agent/package.json` from `^1.1.0` to `^1.2.0`.
- Remove `@google-cloud/vertexai` from `functions/package.json` entirely.
- In `functions/src/generateReply.ts`: replace the dynamic
  `import("@google-cloud/vertexai")` / `VertexAI` / `getGenerativeModel` flow
  with `new GoogleGenAI({ vertexai: true, project, location })` from
  `@google/genai`. `getModel()` and `getTextGenerator()` are rewritten against
  the new client's `ai.models.generateContent(...)` call.
- **Test-first**: update `generateReply.test.ts` mocks to match the new SDK's
  response shape (including `groundingMetadata` present/absent cases) before
  changing the implementation — the new SDK's response shape differs from the
  old Vertex AI SDK's, so the updated tests should drive the migration.

### 2. Backend tool wiring + grounding extraction (`generateReply.ts`)

- Build the tools array via
  `buildAuthorizedToolsArray([googleSearchManifest], [])`. `google_search` is
  `core`-scoped, so it is always authorized regardless of granted scopes —
  this produces `[{ google_search: {} }]` unconditionally.
- **Key-shape adapter** (required — `core-llm-tools`' snake_case
  `google_search` key does not match `@google/genai`'s camelCase `googleSearch`
  field):
  ```ts
  function toGenAITool(entry: GeminiToolEntry): Tool {
    if ('google_search' in entry) return { googleSearch: {} };
    if ('functionDeclarations' in entry) return { functionDeclarations: entry.functionDeclarations };
    throw new Error('Unsupported tool entry');
  }
  ```
- Pass the mapped tools into
  `generateContent({ model, contents, config: { systemInstruction, maxOutputTokens, tools } })`.
- `GenerateTextFn`'s return type changes from `Promise<string>` to
  `Promise<{ text: string; groundingMetadata?: GroundingMetadata }>`.
  `groundingMetadata` is read directly off the typed `Candidate` from
  `@google/genai` (`webSearchQueries`, `groundingChunks`, `groundingSupports`,
  `searchEntryPoint`).
- `GenerateReplyResponse` gets a new optional `groundingMetadata` field,
  passed through to the client as-is — no truncation (Gemini already bounds
  the size).

### 3. Frontend integration

- `chatReplyService.ts`: `GenerateReplyCallableResponse` and
  `GenerateChatReplyResult` get an optional `groundingMetadata` field
  (`webSearchQueries`, `groundingChunks`, `groundingSupports`,
  `searchEntryPoint`), defensively parsed — malformed data is dropped, never
  thrown.
- `aiChatService.ts`: a new augmented type,
  `GroundedIMessage extends IMessage { groundingMetadata?: GroundingMetadata }`.
  `sendMessageWithAIResponse` passes `aiResponse.groundingMetadata` into
  `saveAIMessage`'s `additionalData` when present — this rides the existing
  JSON-persistence path (`message_data` column / `toGiftedChatMessage`), no DB
  schema change needed.
- `ChatView.tsx`: wire `renderCustomView` + `isCustomViewBottom={true}` on
  `GiftedChat`, gated on `currentMessage.groundingMetadata` being present.
  - Citation chips: a tappable list built from `groundingChunks[].web.{uri,
    title}`, opened via `Linking.openURL`.
  - **ToS-required Search Suggestions widget**: Google's grounding terms
    require displaying `searchEntryPoint.renderedContent` (raw HTML) unmodified
    when grounding is used. There is no HTML/WebView renderer currently in the
    app's dependencies.
    - New dependency: `react-native-webview` (Expo-compatible). Render
      `renderedContent` in a sized `WebView` (`source={{ html }}`) below the
      citation chips.

### 4. cloud-agent ADK integration

- `cloud-agent/src/agent.ts`: import `GOOGLE_SEARCH` from `@google/adk` and add
  it to the existing `tools: [...]` array alongside the 10 function tools
  (`getCurrentTimeTool`, `wikiReadTool`, `wikiWriteTool`, `createTaskTool`,
  `listTasksTool`, `updateTaskTool`, `completeTaskTool`, `deleteTaskTool`,
  `documentSearchTool`, `setReminderTool`).
- Gemini 3 models officially support mixing built-in tools (Grounding with
  Google Search) with custom function-calling tools, so no architectural
  workaround is needed here — this requirement is satisfied by the model
  migration in section 5, not by anything ADK-specific.

### 5. Model migration

- Migrate `DEFAULT_MODEL` in `functions/src/generateReply.ts` and the `model:`
  literal in `cloud-agent/src/agent.ts` from `gemini-2.5-flash` to a Gemini
  3-family model.
- **Exact model ID is not finalized in this spec.** Before implementation,
  check Vertex AI documentation/console for `us-central1` availability and
  pricing. Implementation note from the requester: prefer the $0.50/$3.00
  price tier (e.g. a `gemini-3-flash-preview`-class model) over the
  $1.50/$9.00 tier (e.g. a `gemini-3.5-flash`-class model) to protect credit
  economics, provided `us-central1` rate limits are sufficient for that tier.
- This also moves grounding billing from per-prompt to per-search-query —
  worth confirming against current Vertex AI pricing docs at implementation
  time, since it changes the cost model for `creditService`'s 1-credit-per-reply
  charge if search-heavy conversations turn out to cost meaningfully more per
  reply than non-grounded ones.

## Testing strategy

- `generateReply.test.ts`: TDD — write new-SDK mocks first (incl.
  `groundingMetadata` present/absent cases), let them drive the migration
  implementation.
- `chatReplyService.test.ts`: extend for `groundingMetadata` passthrough and
  malformed-data-drop cases.
- `cloud-agent`: integration test confirming `GOOGLE_SEARCH` + the 10 function
  tools coexist on the Gemini 3 model and produce valid responses.
- UI (citation chips + WebView widget): manual verification in simulator —
  no automated visual test.

## Risks / open items carried into implementation

- Exact Gemini 3 model ID and its `us-central1` availability — must be
  confirmed before writing model-literal changes.
- Per-query grounding billing impact on the existing 1-credit-per-reply charge
  model — worth a quick cost sanity check once the model ID is confirmed.
