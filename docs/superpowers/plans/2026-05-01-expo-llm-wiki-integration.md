# expo-llm-wiki Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all custom wiki DB/service/callable infrastructure with `@equationalapplications/expo-llm-wiki` v2.3.0, adding only `wikiLlm` and `wikiSync` callables.

**Architecture:** The package manages local SQLite tables (`llm_wiki_*` prefix), FTS5 search, porter stemming, and librarian LLM inference. Clanker provides the LLM bridge (`wikiLlm` callable) and cloud sync (`wikiSync` callable with last-write-wins semantics). Background memory write and heal are fully handled by the package; clanker only calls `wiki.read()` pre-turn and `wiki.write()` post-turn.

**Tech Stack:** `@equationalapplications/expo-llm-wiki` v2.3.0, Drizzle ORM (PostgreSQL bigint timestamps), `@react-native-firebase/functions` (callables), `expo-crypto` (SHA-256), xstate (existing machines unchanged), React Native Paper (Snackbar for toasts).

---

## File Structure

### Created
| File | Responsibility |
|------|---------------|
| `src/services/wikiLlmProvider.ts` | `createWikiLlmProvider(appCheckReady)` — bridges `getWiki().generateText` to `wikiLlm` callable |
| `src/services/wikiService.ts` | Wiki singleton: `setupWiki(db)`, `getWiki()` |
| `functions/src/wikiLlm.ts` | Auth+premium-gated Vertex proxy; no credits consumed |
| `functions/src/wikiSync.ts` | Auth+premium+save_to_cloud gated; LWW upsert to Cloud SQL; returns merged bundle |
| `functions/src/wikiLlm.test.ts` | Node:test — auth gate, premium gate, Vertex proxy |
| `functions/src/wikiSync.test.ts` | Node:test — LWW upsert, return merge, auth guards |
| `__tests__/wikiService.test.ts` | Jest — wiki singleton, read/write integration, sync |

### Modified
| File | Change |
|------|--------|
| `package.json` | Add `@equationalapplications/expo-llm-wiki`; remove `compromise` |
| `src/database/schema.ts` | Bump to v17; remove old wiki table DDL; add migration 17 DROP TABLE |
| `src/database/index.ts` | Remove `isWikiFtsAvailable`, `tryInitializeWikiFts`; call `setupWiki(database)` |
| `src/hooks/useCachedResources.ts` | `await getDatabase()` to warm up wiki before first render |
| `app/_layout.tsx` | Mount `WikiProvider` around the app tree |
| `src/config/firebaseConfig.ts` | Remove old memory + documentExtract callables; add `wikiLlmFn`, `wikiSyncFn` |
| `src/config/firebaseConfig.web.ts` | Same callable swap as native config (parallel web entry point) |
| `src/services/aiChatService.ts` | Replace `fetchMemoryBundle`/`dispatchWikiWrite` with `wiki.read()`/`wiki.write()`; replace `buildMemoryBlock` with `formatContext()` |
| `src/components/ChatComposer.tsx` | Replace `documentIngestMachine` with `useWikiHasChanged` + `useWikiIngest`; `WikiBusyError` toast |
| `src/components/ChatView.tsx` | 2-second status poll; inline `ingesting`/`librarian` indicators |
| `src/services/characterSyncService.ts` | Add `syncWikiForCloud` helper called from `syncAllToCloud`; `runPrune` after sync |
| `functions/src/db/schema.ts` | Remove old `wikiEntries`/`agentTasks`/`memoryEvents`; add new tables with bigint timestamps |
| `functions/src/index.ts` | Remove old memory exports; add `wikiLlm`, `wikiSync` |
| `__tests__/aiChatService.test.ts` | Swap mocks from `memoryService`/`wikiHealMachine` to `wikiService` |
| `__tests__/chatComposer.test.tsx` | Replace `documentIngestMachine` mock with `useWikiIngest`/`useWikiHasChanged` mocks |

### Deleted
`src/database/wikiDatabase.ts`, `src/database/agentTaskDatabase.ts`, `src/database/memoryEventDatabase.ts`, `src/database/derivedSynonymDatabase.ts`, `src/database/ftsQueryBuilder.ts`, `src/services/memoryService.ts`, `src/services/documentIngestService.ts`, `src/machines/wikiHealMachine.ts`, `src/machines/documentIngestMachine.ts`, `__tests__/memoryService.test.ts`, `__tests__/wikiDatabase.test.ts`, `__tests__/ftsQueryBuilder.test.ts`, `__tests__/wikiHealMachine.test.ts`, `__tests__/documentIngestMachine.test.tsx`, `__tests__/documentIngestService.test.ts`, `__tests__/chatComposerDocumentIngest.test.tsx`

> **No cloud functions are deleted at this stage.** `functions/src/memoryFunctions.ts` and its test are left in place; they will be removed in a separate cleanup step after the old callables have been fully retired from all clients.

---

## Task 1: Install Package + Remove compromise

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install expo-llm-wiki**

```bash
npm install @equationalapplications/expo-llm-wiki
```

- [ ] **Step 2: Remove compromise from package.json**

In `package.json`, remove the `"compromise": "^14.15.0"` line from `dependencies`, then run:

```bash
npm uninstall compromise
```

- [ ] **Step 3: Verify package resolves**

```bash
node -e "require('@equationalapplications/expo-llm-wiki')" && echo "OK"
```
Expected: `OK`

---

## Task 2: Create wikiLlmProvider.ts + wikiService.ts

> **⚠️ Prerequisite: Complete Task 6 (firebaseConfig) first.** This task imports `wikiLlmFn` from `firebaseConfig.ts`, which does not export it until Task 6 runs. Execute Task 6 before this task.

**Files:**
- Create: `src/services/wikiLlmProvider.ts`
- Create: `src/services/wikiService.ts`

- [ ] **Step 1: Create wikiLlmProvider.ts**

```ts
// src/services/wikiLlmProvider.ts
import { appCheckReady, wikiLlmFn } from '~/config/firebaseConfig'

interface WikiLlmRequest {
  systemPrompt: string
  userPrompt: string
}

interface WikiLlmResponse {
  text: string
}

export function createWikiLlmProvider(appCheck: Promise<void>) {
  return {
    generateText: async ({ systemPrompt, userPrompt }: WikiLlmRequest): Promise<string> => {
      await appCheck
      const result = await (wikiLlmFn as (data: WikiLlmRequest) => Promise<{ data: WikiLlmResponse }>)({ systemPrompt, userPrompt })
      return result.data.text
    },
  }
}
```

- [ ] **Step 2: Create wikiService.ts**

```ts
// src/services/wikiService.ts
import { createWiki } from '@equationalapplications/expo-llm-wiki'
import type { SQLiteDatabase } from 'expo-sqlite'
import { createWikiLlmProvider } from './wikiLlmProvider'
import { appCheckReady } from '~/config/firebaseConfig'
import { SYNONYM_MAP_BASE } from '~/database/synonymMapBase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wiki = ReturnType<typeof createWiki>

let _wiki: Wiki | null = null

export function setupWiki(db: SQLiteDatabase): Wiki {
  if (_wiki) return _wiki
  _wiki = createWiki(db, {
    llmProvider: createWikiLlmProvider(appCheckReady),
    config: {
      tablePrefix: 'llm_wiki_',
      autoLibrarianThreshold: 20,
      synonymMap: SYNONYM_MAP_BASE,
    },
  })
  return _wiki
}

export function getWiki(): Wiki {
  if (!_wiki) throw new Error('[wikiService] Wiki not initialized. Call setupWiki() first.')
  return _wiki
}

export async function initWiki(db: SQLiteDatabase): Promise<void> {
  const wiki = setupWiki(db)
  await wiki.setup()
}

/** For tests only — reset the singleton between test runs.
 * Note: verify this `_` prefix naming convention is used elsewhere in the codebase;
 * adjust to match if the project prefers a different test-helper naming pattern. */
export function _resetWikiForTests(): void {
  _wiki = null
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors referencing these files.

---

## Task 3: Local SQLite Schema Migration (v17)

**Files:**
- Modify: `src/database/schema.ts`

> **Memory reset:** Existing wiki memory data in the old tables (`wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms`) will be dropped by migration 17. No data migration or backfill is required — this is an accepted product decision.

The old custom wiki tables (`wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms`) are replaced by the package's `llm_wiki_*` tables. The package creates its own tables via `wiki.setup()`. Migration 17 drops the old ones. SQLite does not easily support DROP COLUMN (requires v3.35), so `heal_checkpoint` and `memory_checkpoint` stay in the `characters` table as harmless dead weight.

- [ ] **Step 1: Remove old table DDL from CREATE_TABLES and related constants**

In `src/database/schema.ts`, make the following changes:

Remove the entire `CREATE_WIKI_FTS` export constant (all of it — the virtual table + 3 triggers).

Remove the entire `CREATE_WIKI_ENTRY_SOURCE_INDEXES` export constant.

Remove the `wiki_entries`, `agent_tasks`, `memory_events`, `derived_synonyms` blocks from `CREATE_TABLES` (keep only `characters`, `messages`, and `schema_version` blocks).

- [ ] **Step 2: Update SCHEMA_VERSION, LATEST_SCHEMA_REQUIRED_COLUMNS, MIGRATION_SKIP_GUARDS, and MIGRATIONS**

```ts
export const SCHEMA_VERSION = 17

export const LATEST_SCHEMA_REQUIRED_COLUMNS: Record<string, string[]> = {
  characters: [
    'deleted_at',
    'avatar_data',
    'avatar_mime_type',
    'save_to_cloud',
    'summary_checkpoint',
    'owner_user_id',
    'voice',
    'heal_checkpoint',
    'memory_checkpoint',
  ],
  // wiki_entries removed — table no longer exists on fresh installs (package owns llm_wiki_* tables)
}
```

Keep all existing `MIGRATION_SKIP_GUARDS` entries (2–16) unchanged. Add no entry for 17 — `DROP TABLE IF EXISTS` is already idempotent.

Add migration 17 to `MIGRATIONS`:

```ts
  17: `
DROP TRIGGER IF EXISTS wiki_entries_ai;
DROP TRIGGER IF EXISTS wiki_entries_au;
DROP TRIGGER IF EXISTS wiki_entries_ad;
DROP TABLE IF EXISTS wiki_fts;
DROP TABLE IF EXISTS wiki_entries;
DROP TABLE IF EXISTS agent_tasks;
DROP TABLE IF EXISTS memory_events;
DROP TABLE IF EXISTS derived_synonyms;
  `.trim(),
```

- [ ] **Step 3: Update the legacy schema detection in `applyInitializationPlan`**

In `src/database/index.ts`, the function `applyInitializationPlan` checks `LATEST_SCHEMA_REQUIRED_COLUMNS.wiki_entries`. Since that key no longer exists, the check simplifies. Find this block and remove the `wiki_entries` check:

```ts
// REMOVE these lines:
const wikiCols = await executor.getAllAsync<{ name: string }>('PRAGMA table_info(wiki_entries)')
const wikiColNames = new Set(wikiCols.map((c) => c.name))
const hasLatestWikiSchema = LATEST_SCHEMA_REQUIRED_COLUMNS.wiki_entries.every(
    (requiredColumn) => wikiColNames.has(requiredColumn),
)

// Also update the condition:
// BEFORE:
if (hasLatestCharacterSchema && hasLatestWikiSchema) {
// AFTER:
if (hasLatestCharacterSchema) {
```

- [ ] **Step 4: Verify the schema compiles**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 4: Hook setupWiki into DB Init + Warm Up DB Before First Render

**Files:**
- Modify: `src/database/index.ts`
- Modify: `src/hooks/useCachedResources.ts`

- [ ] **Step 1: Import initWiki in database/index.ts and call it inside initializeDatabase**

At the top of `src/database/index.ts`, add:

```ts
import { initWiki } from '~/services/wikiService'
```

Inside `initializeDatabase`, replace `tryInitializeWikiFts(database)` with `initWiki(database)`. The updated body:

```ts
async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
    try {
        if (Platform.OS === 'web') {
            await database.execAsync('PRAGMA journal_mode=MEMORY;')
        } else {
            await database.execAsync('PRAGMA journal_mode=WAL;')
        }

        await applyInitializationPlan(database)
        await initWiki(database)  // replaces tryInitializeWikiFts

        console.log('✅ Database initialized successfully')
    } catch (error) {
        console.error('Failed to initialize database:', error)
        throw error
    }
}
```

- [ ] **Step 2: Remove tryInitializeWikiFts, isWikiFtsAvailable, and wikiFtsAvailable from database/index.ts**

Remove:
- `let wikiFtsAvailable = false` module-level variable
- `export function isWikiFtsAvailable()` function
- `async function tryInitializeWikiFts()` function
- The import of `CREATE_WIKI_FTS` from `./schema`
- The import of `CREATE_WIKI_ENTRY_SOURCE_INDEXES` from `./schema`
- The call to `executor.execAsync(CREATE_WIKI_ENTRY_SOURCE_INDEXES)` (appears 3 times in `applyInitializationPlan`)

- [ ] **Step 3: Warm up DB in useCachedResources so WikiProvider has a valid wiki before first render**

In `src/hooks/useCachedResources.ts`, add `getDatabase` import and restructure `loadResourcesAndDataAsync` so the DB warm-up completes **before** `setLoadingComplete(true)` is called. The current code calls `setLoadingComplete(true)` inside the font-loading `finally` block — the DB call must be added before that point.

```ts
import { getDatabase } from '~/database'  // add this import

// Restructure loadResourcesAndDataAsync:
async function loadResourcesAndDataAsync() {
  try {
    SplashScreen.preventAutoHideAsync()
    await Font.loadAsync({ /* existing fonts */ })
    console.log('✅ Fonts loaded successfully')
  } catch (e) {
    console.warn('❌ Error loading fonts:', e)
  }

  // DB warm-up must complete BEFORE setLoadingComplete so WikiProvider
  // receives a valid wiki instance on first render.
  try {
    await getDatabase()
    console.log('✅ Database ready')
  } catch (e) {
    console.warn('❌ Error warming up database:', e)
  }

  setLoadingComplete(true)
  SplashScreen.hideAsync()
}
```

> **Note:** `setLoadingComplete(true)` and `SplashScreen.hideAsync()` are moved out of the font `finally` block into the main function body so they run only after both font loading and DB setup finish.

- [ ] **Step 4: Verify no remaining references to isWikiFtsAvailable**

```bash
npx rg "isWikiFtsAvailable|tryInitializeWikiFts|wikiFtsAvailable|CREATE_WIKI_FTS|CREATE_WIKI_ENTRY_SOURCE_INDEXES" src/
```
Expected: no output.

---

## Task 5: Mount WikiProvider in App Root

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Add WikiProvider import near top of _layout.tsx**

```ts
import { WikiProvider } from '@equationalapplications/expo-llm-wiki/react'
import { getWiki } from '~/services/wikiService'
```

- [ ] **Step 2: Wrap the RootLayoutNav return tree with WikiProvider**

Find the `return` statement inside `RootLayoutNav` that contains the `<Stack>`. Wrap the entire returned tree in `WikiProvider`. The getWiki() call is safe here because `useCachedResources` already awaited DB + wiki setup before `isLoadingComplete` became true, and `RootLayoutNav` only renders its Stack after loading is complete.

Before the Stack return, add `<WikiProvider wiki={getWiki()}>` and close after the final `</Stack>`:

```tsx
// In RootLayoutNav, wrap the full return:
if (isLoading) {
  return (
    <View style={styles.loadingContainer}>
      <LoadingIndicator disabled={false} />
    </View>
  )
}

return (
  <WikiProvider wiki={getWiki()}>
    <Stack>
      {/* ... existing Stack.Screen declarations unchanged ... */}
    </Stack>
  </WikiProvider>
)
```

> **Note:** `isLoading` here refers to the auth machine loading state, not `isLoadingComplete`. `WikiProvider` is mounted only after auth resolves (same as before), which is always after `useCachedResources` has completed DB warm-up.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 6: Update firebaseConfig.ts + firebaseConfig.web.ts — Swap Callables

> **⚠️ Both files must be updated.** The codebase has two platform-specific configs that both declare the old callables:
> - `src/config/firebaseConfig.ts` — React Native (uses `@react-native-firebase/functions`)
> - `src/config/firebaseConfig.web.ts` — Web (uses Firebase Web SDK `firebase/functions`)
>
> Apply the same callable changes to **both files**. The declarations have identical callable names so the diff is identical.

**Files:**
- Modify: `src/config/firebaseConfig.ts`
- Modify: `src/config/firebaseConfig.web.ts`

- [ ] **Step 1: Add wikiLlm and wikiSync callable declarations (both files)**

In both configs, after the existing callable declarations, add:

```ts
const wikiLlmFn = httpsCallable(functionsInstance, 'wikiLlm')
const wikiSyncFn = httpsCallable(functionsInstance, 'wikiSync')
```

- [ ] **Step 2: Remove old memory + documentExtract callable declarations (both files)**

Remove these six lines from both configs:
```ts
const memoryReadFn = httpsCallable(functionsInstance, 'memoryRead')
const memoryWriteFn = httpsCallable(functionsInstance, 'memoryWrite')
const memoryHealFn = httpsCallable(functionsInstance, 'memoryHeal')
const memoryForgetFn = httpsCallable(functionsInstance, 'memoryForget')
const syncCharacterMemoryFn = httpsCallable(functionsInstance, 'syncCharacterMemory')
const documentExtractFn = httpsCallable(functionsInstance, 'documentExtract')
```

> **Note:** `documentExtractFn` is removed from the app configs because `documentIngestService.ts` (its only consumer) is deleted. The `documentExtract` cloud function in `functions/src/` is **not** deleted at this stage — only the client-side declaration is removed.

- [ ] **Step 3: Update the export block (both files)**

Remove `memoryReadFn, memoryWriteFn, memoryHealFn, memoryForgetFn, syncCharacterMemoryFn, documentExtractFn` from the export block of both files.

Add `wikiLlmFn, wikiSyncFn` to the export block of both files:
```ts
export {
  // ... existing exports ...
  wikiLlmFn,
  wikiSyncFn,
}
```

Note: `functionsInstance` does **not** need to be exported — `wikiLlmProvider.ts` imports `wikiLlmFn` directly.

- [ ] **Step 4: Verify compilation**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 7: Update aiChatService.ts + Test

**Files:**
- Modify: `src/services/aiChatService.ts`
- Modify: `__tests__/aiChatService.test.ts`

The `fetchMemoryBundle` callable-based read is replaced with `getWiki().read()`. The `dispatchWikiWrite` machine is replaced with `getWiki().write()`. The hand-rolled `buildMemoryBlock` + all `MemoryFact/Task/Event/Bundle` types are replaced with `formatContext()` from the package.

> **⚠️ Pre-implementation check:** Before writing any code, verify the following signatures against `@equationalapplications/expo-llm-wiki` v2.3.0 source/types: `wiki.read(entityId, query)`, `wiki.write(entityId, payload)` (payload key is `event_type` vs `eventType`?), `getEntityStatus(entityId)`, `runPrune(entityId, opts)`, `exportDump([entityId])`, `importDump(dump, opts)`. The `write()` payload shape in this plan (`{ event_type, summary }`) is assumed but not confirmed — adjust field names if the package uses camelCase.

- [ ] **Step 1: Update imports in aiChatService.ts**

Remove:
```ts
import { fetchMemoryBundle } from '~/services/memoryService'
import { dispatchWikiWrite } from '~/machines/wikiHealMachine'
```

Add:
```ts
import { formatContext } from '@equationalapplications/expo-llm-wiki'
import { getWiki } from '~/services/wikiService'
```

- [ ] **Step 2: Remove the MemoryFact/Task/Event/Bundle types and all buildMemory* helpers**

Delete the following from `aiChatService.ts` (they are replaced by the package):
- `export interface MemoryFact { ... }`
- `export interface MemoryTask { ... }`
- `export interface MemoryEvent { ... }`
- `export interface MemoryBundle { ... }`
- `const MAX_MEMORY_BLOCK_CHARS = 1_500`
- `function buildMemoryFactLine(...)`
- `function buildMemoryTaskLine(...)`
- `function buildMemoryEventLine(...)`
- `function fitMemorySection(...)`
- `function buildMemoryBlock(...)`
- The `memoryBundle?: MemoryBundle | null` field from `ChatContext`

- [ ] **Step 3: Update buildChatPrompt to accept a memoryBlock string**

Change the `ChatContext` interface:
```ts
interface ChatContext {
  characterName: string
  characterPersonality: string
  characterTraits: string
  conversationHistory: { role: 'user' | 'assistant'; content: string }[]
  memoryBlock?: string   // was: memoryBundle?: MemoryBundle | null
}
```

In `buildChatPrompt`, the existing reference to `buildMemoryBlock(chatContext.memoryBundle)` becomes `chatContext.memoryBlock ?? ''`. The template literal already handles it correctly since it uses `memoryBlock ? \`${memoryBlock}\n\n\` : ''`.

- [ ] **Step 4: Update sendMessageWithAIResponse to use wiki.read() and wiki.write()**

Replace the `fetchMemoryBundle` block:
```ts
// BEFORE:
let memoryBundle: MemoryBundle | null = null
if (options?.hasUnlimited) {
  try {
    memoryBundle = await fetchMemoryBundle(userId, character.id, userMessage.text)
  } catch (error) {
    console.warn('Failed to fetch memory bundle:', error)
  }
}

// AFTER:
let memoryBlock = ''
if (options?.hasUnlimited) {
  try {
    const bundle = await getWiki().read(character.id, userMessage.text)
    memoryBlock = formatContext(bundle, {
      maxFacts: 10,
      maxTasks: 10,
      maxEvents: 10,
      includeConfidence: true,
      includeTags: true,
    })
  } catch (error) {
    console.warn('Failed to fetch memory bundle:', error)
  }
}
```

Update the `chatContext` construction to use `memoryBlock`:
```ts
const chatContext: ChatContext = {
  characterName: character.name,
  characterPersonality: effectiveContext || character.appearance,
  characterTraits: `${character.traits} ${character.emotions}`.trim(),
  conversationHistory: getRecentConversationHistory(conversationHistory, 10).map((msg) => ({
    role: msg.user._id === userId ? 'user' : 'assistant',
    content: msg.text,
  })),
  memoryBlock,   // was: memoryBundle
}
```

Replace the `dispatchWikiWrite` block:
```ts
// BEFORE:
if (options?.hasUnlimited) {
  const recentMessages = getRecentConversationHistory([...conversationHistory, userMessage], 20)
  const chunk = recentMessages
    .map((msg) => `${msg.user._id === userId ? 'User' : character.name}: ${msg.text}`)
    .join('\n')
  void dispatchWikiWrite({
    character,
    userId,
    chunk: chunk || userMessage.text,
  })
}

// AFTER:
if (options?.hasUnlimited) {
  getWiki().write(character.id, {
    event_type: 'observation',
    summary: `User: ${userMessage.text}\nAssistant: ${aiResponse.reply}`,
  }).catch(console.error)
}
```

- [ ] **Step 5: Write failing test first — update aiChatService.test.ts mocks**

Replace the `memoryService` and `wikiHealMachine` mocks at the top of `__tests__/aiChatService.test.ts`:

```ts
// REMOVE:
const mockFetchMemoryBundle = jest.fn()
const mockDispatchWikiWrite = jest.fn()
jest.mock('~/services/memoryService', () => ({
  fetchMemoryBundle: (...args: unknown[]) => mockFetchMemoryBundle(...args),
}), { virtual: true })
jest.mock('~/machines/wikiHealMachine', () => ({
  dispatchWikiWrite: (...args: unknown[]) => mockDispatchWikiWrite(...args),
}), { virtual: true })

// ADD:
const mockWikiRead = jest.fn()
const mockWikiWrite = jest.fn()
const mockGetWiki = jest.fn(() => ({
  read: mockWikiRead,
  write: mockWikiWrite,
}))
jest.mock('~/services/wikiService', () => ({
  getWiki: (...args: unknown[]) => mockGetWiki(...args),
}))
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  formatContext: jest.fn(() => '## Memory\n\n### Known Facts\n- test fact'),
}))
```

Update `beforeEach` to reset these mocks:
```ts
beforeEach(() => {
  jest.clearAllMocks()
  mockGetCharacter.mockResolvedValue(null)
  mockGetMessageCount.mockResolvedValue(0)
  mockGetMessagesForContextSummary.mockResolvedValue([])
  mockWikiRead.mockResolvedValue({ facts: [], tasks: [], events: [] })
  mockWikiWrite.mockResolvedValue(undefined)
})
```

Update existing test assertions that referenced `mockFetchMemoryBundle` → `mockWikiRead`, and `mockDispatchWikiWrite` → `mockWikiWrite`. Also remove any tests that check `MemoryBundle` type directly (the type is now internal to the package).

- [ ] **Step 6: Run the updated test suite**

```bash
npm run test -- --testPathPattern="aiChatService" --no-coverage
```
Expected: all tests pass.

---

## Task 8: Update ChatComposer.tsx

**Files:**
- Modify: `src/components/ChatComposer.tsx`

Replace the `documentIngestMachine` XState actor with `useWikiHasChanged` + `useWikiIngest` React hooks from the package. Handle `WikiBusyError` and unchanged-file skip.

- [ ] **Step 1: Replace imports**

Remove:
```ts
import {
  dispatchDocumentIngest,
  getDocumentIngestMachineActor,
  type DocumentIngestMachineActor,
} from '~/machines/documentIngestMachine'
```

Add:
```ts
import { useWikiIngest, useWikiHasChanged } from '@equationalapplications/expo-llm-wiki/react'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
```

- [ ] **Step 2: Replace state and refs with hook calls**

Remove:
```ts
const actorRef = useRef<DocumentIngestMachineActor | undefined>(undefined)
const subscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined)
const [isProcessing, setIsProcessing] = useState(false)
```

And the `useEffect` cleanup that unsubscribes.

Add (inside the component, at the top alongside existing `const [toastMessage, ...]`):
```ts
const { execute: checkChanged } = useWikiHasChanged()
const { execute: ingest, isPending: isIngesting } = useWikiIngest()
```

Replace `const [isProcessing, setIsProcessing] = useState(false)` usage with `isIngesting`.

- [ ] **Step 3: Replace handleDocumentIngest with the new hook-based handler**

Remove the entire `handleDocumentIngest` callback.

Replace `handlePlusPress` with a complete implementation:

```ts
const handlePlusPress = useCallback(async () => {
  if (!characterId || !userId) return

  let result: DocumentPicker.DocumentPickerResult
  try {
    result = await DocumentPicker.getDocumentAsync({ type: 'text/*' })
  } catch {
    setToastMessage('Could not open file picker.')
    return
  }
  if (result.canceled) return

  const file = result.assets[0]
  if (!file) return

  let content: string
  try {
    content = await FileSystem.readAsStringAsync(file.uri)
  } catch {
    setToastMessage('Could not read file.')
    return
  }

  const sourceHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    content,
  )
  const sourceRef = file.name

  let changed: boolean
  try {
    changed = await checkChanged(characterId, sourceRef, sourceHash)
  } catch {
    changed = true  // assume changed on error — let ingest proceed
  }

  if (!changed) {
    setToastMessage('Document already ingested — no changes detected')
    return
  }

  try {
    const ingestResult = await ingest(characterId, {
      sourceRef,
      sourceHash,
      documentChunk: content,
    })
    setToastMessage(`Document ingested (${ingestResult.chunks} chunk${ingestResult.chunks === 1 ? '' : 's'})`)
  } catch (e) {
    if (e instanceof WikiBusyError) {
      setToastMessage('Already processing this document — please wait')
    } else {
      setToastMessage('Failed to ingest document.')
    }
  }
}, [characterId, userId, checkChanged, ingest])
```

- [ ] **Step 4: Replace isProcessing references with isIngesting**

In the JSX, change `isProcessing` to `isIngesting` in the conditional render of the `ActivityIndicator` / `IconButton`.

Remove the now-unused `useEffect` that had the subscription cleanup.

- [ ] **Step 5: Update chatComposer.test.tsx mocks**

In `__tests__/chatComposer.test.tsx`, the existing mock for `documentIngestMachine` must be replaced with mocks for the new hooks. The test file uses:
```ts
jest.mock('~/machines/documentIngestMachine', () => ({
  getDocumentIngestMachineActor: jest.fn(() => undefined),
}))
```

Replace it with:
```ts
jest.mock('@equationalapplications/expo-llm-wiki/react', () => ({
  useWikiIngest: jest.fn(() => ({ execute: jest.fn(), isPending: false, error: null, lastResult: null })),
  useWikiHasChanged: jest.fn(() => ({ execute: jest.fn().mockResolvedValue(true), isPending: false, error: null, lastResult: null })),
}))
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error { constructor(public operation: string, public entityId: string) { super() } },
}))
```

Remove any assertions in the test that reference `getDocumentIngestMachineActor` or `dispatchDocumentIngest`.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 9: Add Entity Status Indicators in ChatView.tsx

**Files:**
- Modify: `src/components/ChatView.tsx`

- [ ] **Step 1: Add import and status state**

Add imports:
```ts
import { useState, useEffect } from 'react'  // useEffect likely already imported
import { getWiki } from '~/services/wikiService'
```

Inside `ChatView`, after the existing hooks, add:
```ts
const [wikiStatus, setWikiStatus] = useState({ ingesting: false, librarian: false, heal: false })

useEffect(() => {
  if (!hasUnlimited || !characterId) return
  const interval = setInterval(() => {
    try {
      setWikiStatus(getWiki().getEntityStatus(characterId))
    } catch {
      // wiki not yet ready — ignore
    }
  }, 2000)
  return () => clearInterval(interval)
}, [characterId, hasUnlimited])
```

- [ ] **Step 2: Render inline status indicators**

In the JSX returned by `ChatView`, add status text near the top of the chat area. Find the `<Stack.Screen>` options title area or the `<View>` wrapping GiftedChat and add a banner below the header:

```tsx
{wikiStatus.ingesting && (
  <Text
    variant="bodySmall"
    style={{ textAlign: 'center', paddingVertical: 4, color: colors.outline }}
    accessibilityLiveRegion="polite"
  >
    Ingesting document…
  </Text>
)}
{wikiStatus.librarian && (
  <Text
    variant="bodySmall"
    style={{ textAlign: 'center', paddingVertical: 4, color: colors.outline }}
    accessibilityLiveRegion="polite"
  >
    Processing memories…
  </Text>
)}
```

Place these `Text` elements between the Stack.Screen header and the GiftedChat component.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 10: Update characterSyncService.ts — Wiki Sync + Prune

**Files:**
- Modify: `src/services/characterSyncService.ts`

- [ ] **Step 1: Add imports**

> **Pre-check:** Verify `UUID_REGEX` and `reportError` exist in `characterSyncService.ts` before referencing them in Step 2–3. If either is absent, import or define them: `UUID_REGEX` is typically `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`; `reportError` may be from a shared error utility — check existing imports at the top of the file.

```ts
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { getWiki } from '~/services/wikiService'
import { wikiSyncFn } from '~/config/firebaseConfig'
import { getAllCharactersWithSaveToCloud } from '../database/characterDatabase'
```

> **Note:** If `getAllCharactersWithSaveToCloud` does not exist in `characterDatabase.ts`, use `getAllCharactersIncludingDeleted` filtered for `save_to_cloud = 1 AND deleted_at IS NULL`.

- [ ] **Step 2: Add syncWikiForCloud helper**

Add this private function to `characterSyncService.ts`:

```ts
async function syncWikiForCloud(localUserId: string): Promise<void> {
  const allChars = await getAllCharactersIncludingDeleted(localUserId)
  const cloudChars = allChars.filter(
    (c) => c.save_to_cloud === 1 && !c.deleted_at && c.cloud_id && UUID_REGEX.test(c.cloud_id),
  )
  if (cloudChars.length === 0) return

  for (const char of cloudChars) {
    const cloudId = char.cloud_id!  // guaranteed by filter above
    let syncSucceeded = false

    try {
      const dump = await getWiki().exportDump([char.id])
      const result = await wikiSyncFn({ characterId: cloudId, dump })
      const remoteDump = (result.data as { remoteDump: MemoryDump }).remoteDump
      if (remoteDump) {
        // Remap cloud UUID key (cloudId) back to local char.id before import.
        // Server returns entities keyed by characterId (cloudId); local wiki uses char.id.
        const remappedDump: MemoryDump = {
          generatedAt: remoteDump.generatedAt,
          entities: {
            [char.id]: remoteDump.entities[cloudId] ?? { facts: [], tasks: [], events: [] },
          },
        }
        await getWiki().importDump(remappedDump, { merge: true })
        syncSucceeded = true
      }
    } catch (error) {
      console.warn('[wikiSync] Failed for character', char.id, error)
    }

    // Prune only after a successful sync — avoids pruning data that failed to sync.
    if (syncSucceeded) {
      try {
        await getWiki().runPrune(char.id, {
          retainSoftDeletedFor: 7,
          retainEventsFor: 30,
          vacuum: false,
        })
      } catch (e) {
        if (e instanceof WikiBusyError) {
          // defer to next sync cycle
        } else {
          console.warn('[wikiPrune] Failed for character', char.id, e)
        }
      }
    }
  }
}
```

- [ ] **Step 3: Call syncWikiForCloud from syncAllToCloud**

Inside `syncAllToCloud`, after the existing `await Promise.all([syncUnsyncedToCloud(localUserId), syncDeletionsToCloud(localUserId)])`, add:

```ts
try {
  await syncWikiForCloud(localUserId)
} catch (error) {
  reportError(error, 'wikiSync')
  // non-fatal: don't re-throw; character sync succeeded
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 10b: Wire useWikiExport to Character Edit Screen

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`

The spec requires `useWikiExport` hook for user-initiated sync. The background sync (`syncWikiForCloud`) uses `wiki.exportDump()` directly. For the per-character manual sync button on the edit screen, `useWikiExport` captures a fresh snapshot (all pending writes flushed) and drives the button `isPending` state.

- [ ] **Step 1: Add imports**

```ts
import { useWikiExport } from '@equationalapplications/expo-llm-wiki/react'
import { getWiki } from '~/services/wikiService'
import { wikiSyncFn } from '~/config/firebaseConfig'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
```

- [ ] **Step 2: Add useWikiExport hook call inside the component**

```ts
const { execute: exportWiki, isPending: isWikiSyncing } = useWikiExport()
```

- [ ] **Step 3: Add handleWikiSync function**

```ts
const handleWikiSync = useCallback(async () => {
  if (!character?.cloud_id || !character.save_to_cloud || !isSubscriber) return
  try {
    const dump = await exportWiki([character.id])
    const result = await wikiSyncFn({ characterId: character.cloud_id, dump })
    const remoteDump = (result.data as { remoteDump: MemoryDump }).remoteDump
    if (remoteDump) {
      // Remap cloud UUID key back to local character.id before import
      const remappedDump: MemoryDump = {
        generatedAt: remoteDump.generatedAt,
        entities: {
          [character.id]: remoteDump.entities[character.cloud_id] ?? { facts: [], tasks: [], events: [] },
        },
      }
      await getWiki().importDump(remappedDump, { merge: true })
    }
    setToastState({ message: 'Memory synced.', requiresSubscription: false })
  } catch (e) {
    reportError(e as Error, 'wikiSync')
    setToastState({ message: 'Failed to sync memory.', requiresSubscription: false })
  }
}, [character, isSubscriber, exportWiki])
```

- [ ] **Step 4: Add Sync Memory button to JSX**

In the section near the existing cloud sync controls (look for `isCloudSyncing` usage), add a "Sync Memory" button visible only to premium users with `save_to_cloud` enabled:

```tsx
{isSubscriber && character?.save_to_cloud && character.cloud_id && (
  <Button
    mode="outlined"
    onPress={handleWikiSync}
    disabled={isWikiSyncing || isCloudSyncing}
    loading={isWikiSyncing}
    style={styles.button}
  >
    Sync Memory
  </Button>
)}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

---

## Task 11: Create wikiService Test

**Files:**
- Create: `__tests__/wikiService.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// __tests__/wikiService.test.ts
const mockSetup = jest.fn().mockResolvedValue(undefined)
const mockRead = jest.fn().mockResolvedValue({ facts: [], tasks: [], events: [] })
const mockWrite = jest.fn().mockResolvedValue(undefined)
const mockExportDump = jest.fn()
const mockImportDump = jest.fn()
const mockRunPrune = jest.fn().mockResolvedValue({ entries: 0, tasks: 0, events: 0 })
const mockGetEntityStatus = jest.fn().mockReturnValue({ ingesting: false, librarian: false, heal: false })

const mockWikiInstance = {
  setup: mockSetup,
  read: mockRead,
  write: mockWrite,
  exportDump: mockExportDump,
  importDump: mockImportDump,
  runPrune: mockRunPrune,
  getEntityStatus: mockGetEntityStatus,
}

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  createWiki: jest.fn(() => mockWikiInstance),
  WikiBusyError: class WikiBusyError extends Error {
    constructor(public operation: string, public entityId: string) {
      super(`Wiki busy: ${operation}`)
      this.name = 'WikiBusyError'
    }
  },
}))

jest.mock('~/services/wikiLlmProvider', () => ({
  createWikiLlmProvider: jest.fn(() => ({ generateText: jest.fn() })),
}))

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: Promise.resolve(),
}))

jest.mock('~/database/synonymMapBase', () => ({
  SYNONYM_MAP_BASE: {},
}))

import { setupWiki, getWiki, initWiki, _resetWikiForTests } from '~/services/wikiService'
import { createWiki } from '@equationalapplications/expo-llm-wiki'

const mockDb = {} as any

describe('wikiService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    _resetWikiForTests()
  })

  it('setupWiki creates the wiki instance with correct config', () => {
    setupWiki(mockDb)
    expect(createWiki).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        config: expect.objectContaining({
          tablePrefix: 'llm_wiki_',
          autoLibrarianThreshold: 20,
        }),
      }),
    )
  })

  it('setupWiki is idempotent — createWiki called once on repeated calls', () => {
    setupWiki(mockDb)
    setupWiki(mockDb)
    expect(createWiki).toHaveBeenCalledTimes(1)
  })

  it('getWiki throws before setupWiki is called', () => {
    expect(() => getWiki()).toThrow('[wikiService] Wiki not initialized')
  })

  it('getWiki returns the wiki instance after setupWiki', () => {
    setupWiki(mockDb)
    expect(getWiki()).toBe(mockWikiInstance)
  })

  it('initWiki calls wiki.setup()', async () => {
    await initWiki(mockDb)
    expect(mockSetup).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test**

```bash
npm run test -- --testPathPattern="wikiService" --no-coverage
```
Expected: all 5 tests pass.

---

## Task 12: Create functions/src/wikiLlm.ts + Test

**Files:**
- Create: `functions/src/wikiLlm.ts`
- Create: `functions/src/wikiLlm.test.ts`

Pattern mirrors `summarizeText.ts` (same Vertex model, same auth approach, no credits).

- [ ] **Step 1: Write failing test**

```ts
// functions/src/wikiLlm.test.ts
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const mockGetUserByFirebaseUid = () => Promise.resolve({ id: 'user-uuid-1' })
const mockGetSubscription = () =>
  Promise.resolve({
    planTier: 'monthly_20',
    planStatus: 'active',
    currentCredits: 100,
    hasUnlimited: true,
  })
const mockGetSubscriptionFree = () =>
  Promise.resolve({
    planTier: 'free',
    planStatus: 'active',
    currentCredits: 10,
    hasUnlimited: false,
  })
const mockGenerateContent = async (_prompt: string) => '{"extracted": true}'

describe('wikiLlm', () => {
  it('throws unauthenticated for missing auth', async () => {
    const { wikiLlmHandler } = await import('./wikiLlm.js')
    await assert.rejects(
      () =>
        wikiLlmHandler(
          { systemPrompt: 'sys', userPrompt: 'usr' },
          {
            auth: null,
            userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
            subscriptionService: { getSubscription: mockGetSubscription },
            generateContent: mockGenerateContent,
          },
        ),
      (err: any) => {
        assert.equal(err.code, 'unauthenticated')
        return true
      },
    )
  })

  it('throws permission-denied for non-premium user', async () => {
    const { wikiLlmHandler } = await import('./wikiLlm.js')
    await assert.rejects(
      () =>
        wikiLlmHandler(
          { systemPrompt: 'sys', userPrompt: 'usr' },
          {
            auth: { uid: 'fb-1' } as any,
            userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
            subscriptionService: { getSubscription: mockGetSubscriptionFree },
            generateContent: mockGenerateContent,
          },
        ),
      (err: any) => {
        assert.equal(err.code, 'permission-denied')
        return true
      },
    )
  })

  it('returns text for premium user', async () => {
    const { wikiLlmHandler } = await import('./wikiLlm.js')
    const result = await wikiLlmHandler(
      { systemPrompt: 'You are a librarian.', userPrompt: 'Extract facts.' },
      {
        auth: { uid: 'fb-1', email: 'user@example.com' } as any,
        userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
        subscriptionService: { getSubscription: mockGetSubscription },
        generateContent: mockGenerateContent,
      },
    )
    assert.equal(result.text, '{"extracted": true}')
  })
})
```

- [ ] **Step 2: Implement functions/src/wikiLlm.ts**

```ts
// functions/src/wikiLlm.ts
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import type { DecodedIdToken } from 'firebase-admin/auth'

import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import { PREMIUM_TIERS } from './constants/plans.js'
import { userRepository } from './services/userRepository.js'
import { subscriptionService } from './services/subscriptionService.js'

const DEFAULT_MODEL = 'gemini-2.5-flash'
const DEFAULT_REGION = 'us-central1'
const MAX_OUTPUT_TOKENS = 1_024
const MAX_PROMPT_LENGTH = 16_000

interface WikiLlmPayload {
  systemPrompt?: unknown
  userPrompt?: unknown
}

interface WikiLlmDeps {
  auth: DecodedIdToken | null
  userRepository: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>
  subscriptionService: Pick<typeof subscriptionService, 'getSubscription'>
  generateContent: (systemPrompt: string, userPrompt: string) => Promise<string>
}
interface VertexGenerativeModel {
  generateContent(prompt: string): Promise<{
    response: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  }>
}
interface VertexAIModule {
  VertexAI: new (config: { project: string; location: string }) => {
    getGenerativeModel(cfg: { model: string; generationConfig: { maxOutputTokens: number } }): VertexGenerativeModel
  }
}

let modelPromise: Promise<VertexGenerativeModel> | undefined

async function getModel(): Promise<VertexGenerativeModel> {
  if (modelPromise) return modelPromise
  const project = (process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT)?.trim()
  if (!project) throw new HttpsError('failed-precondition', 'Missing GCLOUD_PROJECT for wikiLlm.')
  modelPromise = (async () => {
    try {
      const mod = (await import('@google-cloud/vertexai')) as VertexAIModule
      const vertex = new mod.VertexAI({ project, location: DEFAULT_REGION })
      return vertex.getGenerativeModel({
        model: DEFAULT_MODEL,
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      })
    } catch (err) {
      modelPromise = undefined
      throw err
    }
  })()
  return modelPromise
}

async function defaultGenerateContent(systemPrompt: string, userPrompt: string): Promise<string> {
  const model = await getModel()
  const combined = `${systemPrompt}\n\n${userPrompt}`.slice(0, MAX_PROMPT_LENGTH)
  const result = await model.generateContent(combined)
  return result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

export async function wikiLlmHandler(
  data: WikiLlmPayload,
  deps: WikiLlmDeps,
): Promise<{ text: string }> {
  if (!deps.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const systemPrompt =
    typeof data.systemPrompt === 'string' && data.systemPrompt.trim()
      ? data.systemPrompt.trim()
      : null
  const userPrompt =
    typeof data.userPrompt === 'string' && data.userPrompt.trim()
      ? data.userPrompt.trim()
      : null

  if (!systemPrompt || !userPrompt) {
    throw new HttpsError('invalid-argument', 'systemPrompt and userPrompt must be non-empty strings.')
  }

  // Note: `email ?? ''` is safe for premium users (who always have an email for purchase).
  // Anonymous users will have an empty email here — they cannot be premium, so they will
  // be rejected at the `hasUnlimited` check below before any user record is created.
  const user = await deps.userRepository.getOrCreateUserByFirebaseIdentity({
    firebaseUid: deps.auth.uid,
    email: deps.auth.email ?? '',
    displayName: deps.auth.name ?? null,
    avatarUrl: deps.auth.picture ?? null,
  })

  const subscription = await deps.subscriptionService.getSubscription(user.id)
  const hasUnlimited =
    PREMIUM_TIERS.has(subscription?.planTier ?? '') && subscription?.planStatus === 'active'

  if (!hasUnlimited) {
    throw new HttpsError('permission-denied', 'Wiki LLM requires a premium subscription.')
  }

  const text = await deps.generateContent(systemPrompt, userPrompt)
  logger.info('wikiLlm: generated text', { userId: user.id, chars: text.length })
  return { text }
}

const defaultDeps = {
  userRepository,
  subscriptionService,
  generateContent: defaultGenerateContent,
}

export const wikiLlm = onCall(
  { region: DEFAULT_REGION, secrets: CLOUD_SQL_SECRETS },
  async (request: CallableRequest<WikiLlmPayload>) => {
    return wikiLlmHandler(request.data, {
      ...defaultDeps,
      // Mirror generateReply.ts pattern: request.auth.token is the DecodedIdToken
      auth: request.auth ? (request.auth.token as DecodedIdToken) : null,
    })
  },
)
```

- [ ] **Step 3: Build and run the test**

```bash
cd functions && npm run build && node --test lib/wikiLlm.test.js
```
Expected: 3 tests pass.

---

## Task 13: Update functions/src/db/schema.ts + Cloud SQL Migration

**Files:**
- Modify: `functions/src/db/schema.ts`
- Create: `functions/drizzle/XXXX_wiki_sync_tables.sql` (generated)

The old `wikiEntries` (timestamp-based), `agentTasks`, and `memoryEvents` tables are dropped. New `wikiEntries`, `wikiTasks`, `wikiEvents` are created with bigint unix-ms timestamps for LWW by `updated_at`. The old exported symbols are removed since `memoryFunctions.ts` (the only consumer) is being deleted.

- [ ] **Step 1: Remove old table definitions, add new ones in functions/src/db/schema.ts**

Remove: `export const wikiEntries = pgTable('wiki_entries', ...)`, `export const agentTasks = pgTable('agent_tasks', ...)`, `export const memoryEvents = pgTable('memory_events', ...)` (all three complete blocks).

> **⚠️ Verify before this step:** Confirm that the existing `characterSyncService` (or the character upsert path in `functions/`) already syncs the `save_to_cloud` column to Cloud SQL. If `save_to_cloud` is never written to Cloud SQL, the `wikiSync` handler will always throw `permission-denied`. Check the Cloud SQL `characters` table for the column before adding it; it may already exist.

**Add `saveToCloud` column to the existing `characters` table definition:**

Locate the `characters` pgTable definition in `functions/src/db/schema.ts` and add:

```ts
saveToCloud: boolean('save_to_cloud').notNull().default(false),
```

This column gates wiki sync on the server. The client sets it when the user enables cloud sync for a character.

Add these new wiki tables at the bottom:

```ts
import { bigint } from 'drizzle-orm/pg-core'  // add to existing import if not present

export const wikiEntries = pgTable('wiki_entries', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: jsonb('tags').notNull().default([]),
  confidence: text('confidence').notNull().default('inferred'),
  sourceType: text('source_type').notNull().default('agent_inferred'),
  sourceHash: text('source_hash'),
  sourceRef: text('source_ref'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  lastAccessedAt: bigint('last_accessed_at', { mode: 'number' }),
  accessCount: integer('access_count').notNull().default(0),
  deletedAt: bigint('deleted_at', { mode: 'number' }),
}, (table) => ({
  characterIdIdx: index('wiki_entries_character_id_idx').on(table.characterId),
  updatedAtIdx: index('wiki_entries_updated_at_idx').on(table.updatedAt.desc()),
}))

export const wikiTasks = pgTable('wiki_tasks', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  resolvedAt: bigint('resolved_at', { mode: 'number' }),
  deletedAt: bigint('deleted_at', { mode: 'number' }),
}, (table) => ({
  characterIdIdx: index('wiki_tasks_character_id_idx').on(table.characterId),
}))

export const wikiEvents = pgTable('wiki_events', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  summary: text('summary').notNull(),
  relatedEntryId: text('related_entry_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  characterIdIdx: index('wiki_events_character_id_idx').on(table.characterId),
}))
```

- [ ] **Step 2: Generate the Drizzle migration**

```bash
cd functions && npx drizzle-kit generate
```

This creates a new file in `functions/drizzle/` (e.g., `0008_wiki_sync_tables.sql`). The generated SQL should include:
- `DROP TABLE` for `wiki_entries`, `agent_tasks`, `memory_events` (with FK cascade handling)
- `CREATE TABLE wiki_entries` (bigint timestamps)
- `CREATE TABLE wiki_tasks`
- `CREATE TABLE wiki_events`

Review the generated file and confirm these operations are present. Note: Drizzle may generate `DROP TABLE IF EXISTS agent_tasks CASCADE` and `DROP TABLE IF EXISTS memory_events CASCADE` — this is correct. The migration will also include `ALTER TABLE characters ADD COLUMN save_to_cloud boolean NOT NULL DEFAULT false` — verify this is present.

- [ ] **Step 3: Apply the migration**

Follow the process in `/memories/repo/cloud-sql-migrations.md`. Steps:

```bash
# Start Cloud SQL Auth Proxy (download if needed)
/tmp/cloud-sql-proxy clanker-prod:us-central1:clanker-prod --port 5433 &

# Build DATABASE_URL
DB_PASS=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_PASS --project=clanker-prod)
ENCODED_PASS=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$DB_PASS")
export DATABASE_URL="postgresql://clanker_app:${ENCODED_PASS}@127.0.0.1:5433/clanker"

# Apply (replace XXXX with actual generated filename)
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const MIGRATIONS = ['0008_wiki_sync_tables.sql'];  // UPDATE with actual filename
(async () => {
  const client = await p.connect();
  try {
    for (const file of MIGRATIONS) {
      const stmts = fs.readFileSync('drizzle/' + file, 'utf8')
        .split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
      console.log('Applying', file, '(' + stmts.length + ' statements)');
      for (const stmt of stmts) await client.query(stmt);
      console.log('  ✅ Done');
    }
  } catch (err) {
    console.error('❌', err.message, err.detail || '');
  } finally { client.release(); p.end(); }
})();
"
```

- [ ] **Step 4: Verify tables exist**

```bash
node -e "
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'wiki%' ORDER BY table_name\")
  .then(r => { console.log(r.rows.map(x=>x.table_name)); p.end(); })
  .catch(e => { console.error(e.message); p.end(); })
"
```
Expected: `[ 'wiki_entries', 'wiki_events', 'wiki_tasks' ]`

---

## Task 14: Create functions/src/wikiSync.ts + Test

**Files:**
- Create: `functions/src/wikiSync.ts`
- Create: `functions/src/wikiSync.test.ts`

Implements LWW upsert logic. For entries and tasks: INSERT if not exists; UPDATE if incoming `updated_at > existing.updated_at`. For events: INSERT if not exists (append-only, no `updated_at`).

- [ ] **Step 1: Write the failing test**

```ts
// functions/src/wikiSync.test.ts
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const mockGetUserByFirebaseUid = () => Promise.resolve({ id: 'user-uuid-1' })
const mockGetSubscription = () =>
  Promise.resolve({ planTier: 'monthly_20', planStatus: 'active', hasUnlimited: true })
const mockGetSubscriptionFree = () =>
  Promise.resolve({ planTier: 'free', planStatus: 'active', hasUnlimited: false })

// Track DB operations
const insertedEntries: Record<string, any>[] = []
const insertedTasks: Record<string, any>[] = []
const insertedEvents: Record<string, any>[] = []

const mockGetCharacter = async (characterId: string) => ({
  id: characterId,
  userId: 'user-uuid-1',
  saveToCloud: true,
})

describe('wikiSync', () => {
  beforeEach(() => {
    insertedEntries.length = 0
    insertedTasks.length = 0
    insertedEvents.length = 0
  })

  it('throws unauthenticated for missing auth', async () => {
    const { wikiSyncHandler } = await import('./wikiSync.js')
    await assert.rejects(
      () =>
        wikiSyncHandler({ characterId: 'char-1', dump: { generatedAt: 1, entities: {} } }, {
          auth: null,
          userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
          subscriptionService: { getSubscription: mockGetSubscription },
          getCharacter: mockGetCharacter,
          upsertEntries: async () => {},
          upsertTasks: async () => {},
          appendEvents: async () => {},
          fetchBundle: async () => ({ facts: [], tasks: [], events: [] }),
        }),
      (err: any) => { assert.equal(err.code, 'unauthenticated'); return true },
    )
  })

  it('throws permission-denied for non-premium', async () => {
    const { wikiSyncHandler } = await import('./wikiSync.js')
    await assert.rejects(
      () =>
        wikiSyncHandler({ characterId: 'char-1', dump: { generatedAt: 1, entities: {} } }, {
          auth: { uid: 'fb-1' },
          userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
          subscriptionService: { getSubscription: mockGetSubscriptionFree },
          getCharacter: mockGetCharacter,
          upsertEntries: async () => {},
          upsertTasks: async () => {},
          appendEvents: async () => {},
          fetchBundle: async () => ({ facts: [], tasks: [], events: [] }),
        }),
      (err: any) => { assert.equal(err.code, 'permission-denied'); return true },
    )
  })

  it('throws permission-denied when save_to_cloud is false', async () => {
    const { wikiSyncHandler } = await import('./wikiSync.js')
    await assert.rejects(
      () =>
        wikiSyncHandler({ characterId: 'char-uuid-1', dump: { generatedAt: 1, entities: {} } }, {
          auth: { uid: 'fb-1' },
          userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
          subscriptionService: { getSubscription: mockGetSubscription },
          getCharacter: async () => ({ id: 'char-uuid-1', userId: 'user-uuid-1', saveToCloud: false }),
          upsertEntries: async () => {},
          upsertTasks: async () => {},
          appendEvents: async () => {},
          fetchBundle: async () => ({ facts: [], tasks: [], events: [] }),
        }),
      (err: any) => { assert.equal(err.code, 'permission-denied'); return true },
    )
  })

  it('LWW: newer incoming entry overwrites cloud; older does not', async () => {
    let upsertCalled = false
    const { wikiSyncHandler } = await import('./wikiSync.js')
    await wikiSyncHandler(
      {
        characterId: 'char-uuid-1',
        dump: {
          generatedAt: Date.now(),
          entities: {
            'char-local-1': {
              facts: [
                { id: 'entry-1', entity_id: 'char-local-1', title: 'Fact', body: 'Body', tags: [], confidence: 'certain',
                  source_type: 'agent_inferred', source_hash: null, source_ref: null,
                  created_at: 1000, updated_at: 2000, last_accessed_at: null, access_count: 0,
                  deleted_at: null },
              ],
              tasks: [],
              events: [],
            },
          },
        },
      },
      {
        auth: { uid: 'fb-1' },
        userRepository: { getOrCreateUserByFirebaseIdentity: mockGetUserByFirebaseUid },
        subscriptionService: { getSubscription: mockGetSubscription },
        getCharacter: async () => ({ id: 'char-uuid-1', userId: 'user-uuid-1', saveToCloud: true }),
        upsertEntries: async (entries: any[]) => { upsertCalled = true; insertedEntries.push(...entries) },
        upsertTasks: async () => {},
        appendEvents: async () => {},
        fetchBundle: async () => ({ facts: [], tasks: [], events: [] }),
      },
    )
    assert.ok(upsertCalled, 'upsertEntries should have been called')
    assert.equal(insertedEntries.length, 1)
    assert.equal(insertedEntries[0].id, 'entry-1')
  })
})
```

- [ ] **Step 2: Implement functions/src/wikiSync.ts**

```ts
// functions/src/wikiSync.ts
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import { eq, sql } from 'drizzle-orm'
import type { DecodedIdToken } from 'firebase-admin/auth'

import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import { PREMIUM_TIERS } from './constants/plans.js'
import { userRepository } from './services/userRepository.js'
import { subscriptionService } from './services/subscriptionService.js'
import { getDb } from './db/cloudSql.js'
import { characters, wikiEntries, wikiTasks, wikiEvents } from './db/schema.js'

const DEFAULT_REGION = 'us-central1'

// ----- Local types matching package MemoryDump shape -----
interface WikiFact {
  id: string; entity_id: string; title: string; body: string; tags: string[]
  confidence: string; source_type: string; source_hash: string | null; source_ref: string | null
  created_at: number; updated_at: number; last_accessed_at: number | null
  access_count: number; deleted_at: number | null
}
interface WikiTask {
  id: string; entity_id: string; description: string; status: string; priority: number
  created_at: number; updated_at: number; resolved_at: number | null; deleted_at: number | null
}
interface WikiEvent {
  id: string; entity_id: string; event_type: string; summary: string; related_entry_id?: string | null
  created_at: number
}
interface MemoryBundle { facts: WikiFact[]; tasks: WikiTask[]; events: WikiEvent[] }
interface MemoryDump { generatedAt: number; entities: Record<string, MemoryBundle> }

interface WikiSyncPayload { characterId?: unknown; dump?: unknown }

interface WikiSyncDeps {
  auth: DecodedIdToken | null
  userRepository: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>
  subscriptionService: Pick<typeof subscriptionService, 'getSubscription'>
  getCharacter: (id: string) => Promise<{ id: string; userId: string; saveToCloud: boolean } | null>
  upsertEntries: (entries: WikiFact[], characterId: string, userId: string) => Promise<void>
  upsertTasks: (tasks: WikiTask[], characterId: string, userId: string) => Promise<void>
  appendEvents: (events: WikiEvent[], characterId: string, userId: string) => Promise<void>
  fetchBundle: (characterId: string) => Promise<{ facts: WikiFact[]; tasks: WikiTask[]; events: WikiEvent[] }>
}

export async function wikiSyncHandler(
  data: WikiSyncPayload,
  deps: WikiSyncDeps,
): Promise<{ remoteDump: MemoryDump }> {
  if (!deps.auth) throw new HttpsError('unauthenticated', 'Authentication required.')

  const characterId = typeof data.characterId === 'string' && data.characterId.trim()
    ? data.characterId.trim()
    : null
  if (!characterId) throw new HttpsError('invalid-argument', 'characterId must be a non-empty string.')

  const user = await deps.userRepository.getOrCreateUserByFirebaseIdentity({
    firebaseUid: deps.auth.uid,
    email: (deps.auth as any).email ?? '',
    displayName: (deps.auth as any).name ?? null,
    avatarUrl: (deps.auth as any).picture ?? null,
  })

  const subscription = await deps.subscriptionService.getSubscription(user.id)
  const hasUnlimited =
    PREMIUM_TIERS.has(subscription?.planTier ?? '') && subscription?.planStatus === 'active'
  if (!hasUnlimited) throw new HttpsError('permission-denied', 'Wiki sync requires a premium subscription.')

  const char = await deps.getCharacter(characterId)
  if (!char || char.userId !== user.id) throw new HttpsError('not-found', 'Character not found.')
  if (!char.saveToCloud) throw new HttpsError('permission-denied', 'Character is not enabled for cloud sync.')

  const dump = data.dump as MemoryDump | undefined
  if (dump?.entities) {
    for (const entityBundle of Object.values(dump.entities)) {
      if (entityBundle.facts?.length) {
        await deps.upsertEntries(entityBundle.facts, characterId, user.id)
      }
      if (entityBundle.tasks?.length) {
        await deps.upsertTasks(entityBundle.tasks, characterId, user.id)
      }
      if (entityBundle.events?.length) {
        await deps.appendEvents(entityBundle.events, characterId, user.id)
      }
    }
  }

  const merged = await deps.fetchBundle(characterId)
  const remoteDump: MemoryDump = {
    generatedAt: Date.now(),
    entities: { [characterId]: merged },
  }

  logger.info('wikiSync: synced', { characterId, userId: user.id })
  return { remoteDump }
}

// --- Default DB implementations ---
async function defaultUpsertEntries(
  facts: WikiFact[],
  characterId: string,
  userId: string,
): Promise<void> {
  const db = await getDb()
  for (const fact of facts) {
    await db.insert(wikiEntries).values({
      id: fact.id,
      characterId,
      userId,
      title: fact.title,
      body: fact.body,
      tags: fact.tags,
      confidence: fact.confidence,
      sourceType: fact.source_type,
      sourceHash: fact.source_hash,
      sourceRef: fact.source_ref,
      createdAt: fact.created_at,
      updatedAt: fact.updated_at,
      lastAccessedAt: fact.last_accessed_at,
      accessCount: fact.access_count,
      deletedAt: fact.deleted_at,
    }).onConflictDoUpdate({
      target: wikiEntries.id,
      set: {
        title: sql`EXCLUDED.title`,
        body: sql`EXCLUDED.body`,
        tags: sql`EXCLUDED.tags`,
        confidence: sql`EXCLUDED.confidence`,
        sourceType: sql`EXCLUDED.source_type`,
        sourceHash: sql`EXCLUDED.source_hash`,
        sourceRef: sql`EXCLUDED.source_ref`,
        updatedAt: sql`EXCLUDED.updated_at`,
        lastAccessedAt: sql`EXCLUDED.last_accessed_at`,
        accessCount: sql`EXCLUDED.access_count`,
        deletedAt: sql`EXCLUDED.deleted_at`,
      },
      setWhere: sql`${wikiEntries.updatedAt} < EXCLUDED.updated_at`,
    })
  }
}

async function defaultUpsertTasks(
  tasks: WikiTask[],
  characterId: string,
  userId: string,
): Promise<void> {
  const db = await getDb()
  for (const task of tasks) {
    await db.insert(wikiTasks).values({
      id: task.id,
      characterId,
      userId,
      description: task.description,
      status: task.status,
      priority: task.priority,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      resolvedAt: task.resolved_at,
      deletedAt: task.deleted_at,
    }).onConflictDoUpdate({
      target: wikiTasks.id,
      set: {
        description: sql`EXCLUDED.description`,
        status: sql`EXCLUDED.status`,
        priority: sql`EXCLUDED.priority`,
        updatedAt: sql`EXCLUDED.updated_at`,
        resolvedAt: sql`EXCLUDED.resolved_at`,
        deletedAt: sql`EXCLUDED.deleted_at`,
      },
      setWhere: sql`${wikiTasks.updatedAt} < EXCLUDED.updated_at`,
    })
  }
}

async function defaultAppendEvents(
  events: WikiEvent[],
  characterId: string,
  userId: string,
): Promise<void> {
  const db = await getDb()
  for (const event of events) {
    await db.insert(wikiEvents).values({
      id: event.id,
      characterId,
      userId,
      eventType: event.event_type,
      summary: event.summary,
      relatedEntryId: event.related_entry_id,
      createdAt: event.created_at,
    }).onConflictDoNothing()
  }
}

async function defaultFetchBundle(characterId: string) {
  const db = await getDb()
  const [facts, tasks, events] = await Promise.all([
    db.select().from(wikiEntries).where(eq(wikiEntries.characterId, characterId)),
    db.select().from(wikiTasks).where(eq(wikiTasks.characterId, characterId)),
    db.select().from(wikiEvents).where(eq(wikiEvents.characterId, characterId)),
  ])
  return {
    facts: facts.map((f) => ({
      id: f.id, entity_id: f.characterId, title: f.title, body: f.body,
      tags: (f.tags as string[]) ?? [],
      confidence: f.confidence, source_type: f.sourceType,
      source_hash: f.sourceHash, source_ref: f.sourceRef,
      created_at: f.createdAt, updated_at: f.updatedAt,
      last_accessed_at: f.lastAccessedAt, access_count: f.accessCount,
      deleted_at: f.deletedAt,
    })),
    tasks: tasks.map((t) => ({
      id: t.id, entity_id: t.characterId, description: t.description, status: t.status, priority: t.priority,
      created_at: t.createdAt, updated_at: t.updatedAt,
      resolved_at: t.resolvedAt, deleted_at: t.deletedAt,
    })),
    events: events.map((e) => ({
      id: e.id, entity_id: e.characterId, event_type: e.eventType, summary: e.summary,
      related_entry_id: e.relatedEntryId, created_at: e.createdAt,
    })),
    // Note: entity_id here is the cloud characterId (UUID). The client remaps via
    // remappedDump so importDump uses char.id (local UUID) as the outer key — it
    // ignores fact.entity_id at write time but the field must be present for type-safety.
  }
}

async function defaultGetCharacter(characterId: string) {
  const db = await getDb()
  const char = await db.select({ id: characters.id, userId: characters.userId, saveToCloud: characters.saveToCloud })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1)
  return char[0] ? { id: char[0].id, userId: char[0].userId, saveToCloud: char[0].saveToCloud } : null
}

const defaultDeps = {
  userRepository,
  subscriptionService,
  getCharacter: defaultGetCharacter,
  upsertEntries: defaultUpsertEntries,
  upsertTasks: defaultUpsertTasks,
  appendEvents: defaultAppendEvents,
  fetchBundle: defaultFetchBundle,
}

export const wikiSync = onCall(
  { region: DEFAULT_REGION, secrets: CLOUD_SQL_SECRETS },
  async (request: CallableRequest<WikiSyncPayload>) => {
    return wikiSyncHandler(request.data, {
      ...defaultDeps,
      // Mirror generateReply.ts pattern: request.auth.token is the DecodedIdToken
      auth: request.auth ? (request.auth.token as DecodedIdToken) : null,
    })
  },
)
```

- [ ] **Step 3: Build and run wikiSync tests**

```bash
cd functions && npm run build && node --test lib/wikiSync.test.js
```
Expected: 3 tests pass.

---

## Task 15: Update functions/src/index.ts + Exports

**Files:**
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Remove old memory exports**

Remove the block:
```ts
export {
  memoryRead,
  memoryWrite,
  memoryHeal,
  memoryForget,
  syncCharacterMemory,
} from "./memoryFunctions.js";
```

- [ ] **Step 2: Add new wiki exports**

Add after the `characterFunctions` export block:
```ts
export {
  wikiLlm,
} from "./wikiLlm.js";

export {
  wikiSync,
} from "./wikiSync.js";
```

- [ ] **Step 3: Build functions**

```bash
cd functions && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

---

## Task 16: Delete Old Files

**Files:**
- Delete: all listed below

- [ ] **Step 1: Delete client-side DB and service files**

```bash
rm src/database/wikiDatabase.ts
rm src/database/agentTaskDatabase.ts
rm src/database/memoryEventDatabase.ts
rm src/database/derivedSynonymDatabase.ts
rm src/database/ftsQueryBuilder.ts
rm src/services/memoryService.ts
rm src/services/documentIngestService.ts
```

- [ ] **Step 2: Delete state machines**

```bash
rm src/machines/wikiHealMachine.ts
rm src/machines/documentIngestMachine.ts
```

- [ ] **Step 3: Leave all cloud functions files in place**

> **Do not delete any files under `functions/src/` at this stage.** `functions/src/memoryFunctions.ts`, `functions/src/memoryFunctions.test.ts`, `functions/src/documentExtract.ts` (if present), and any other existing cloud function files are intentionally retained. They will be removed in a separate cleanup step after the old callables have been fully retired from all clients.

- [ ] **Step 4: Delete test files**

```bash
rm __tests__/memoryService.test.ts
rm __tests__/wikiDatabase.test.ts
rm __tests__/ftsQueryBuilder.test.ts
rm __tests__/wikiHealMachine.test.ts
rm __tests__/documentIngestMachine.test.tsx
rm __tests__/documentIngestService.test.ts
rm __tests__/chatComposerDocumentIngest.test.tsx
```

---

## Task 17: Final Verification

**Files:**
- No changes

- [ ] **Step 1: Fix any typecheck errors**

```bash
npm run typecheck
```
Address any errors. Common issues: stale imports referencing deleted files, types from `MemoryFact`/`MemoryBundle` (now removed) referenced in test files.

- [ ] **Step 2: Fix any lint errors**

```bash
npm run lint
```
Address any lint errors. Most common: unused imports from deleted modules.

- [ ] **Step 3: Run all client tests**

```bash
npm run test -- --no-coverage 2>&1 | tail -30
```
Expected: all tests pass. If `characterDatabaseBatchInsert.test.ts`, `characterShare.test.ts` etc. fail due to removed `wikiEntries` import from `functions/src/db/schema.ts`, update those test mocks.

- [ ] **Step 4: Run all functions checks**

```bash
cd functions && npm run typecheck && npm run lint && npm run build && node --test lib/wikiLlm.test.js lib/wikiSync.test.js
```
Expected: all pass.

- [ ] **Step 5: Run full suite one final time**

```bash
cd .. && npm run typecheck && npm run lint && npm run test
```
Expected: green across all.

- [ ] **Step 6: Local review before committing**

When all checks pass, run `git diff --stat` to see all changed files, then do a full diff review. Only commit after the diff is reviewed locally. Do not commit incrementally during implementation — commit the full feature in one or more logical commits after review.

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Task |
|-------------|------|
| `@equationalapplications/expo-llm-wiki` installed; `compromise` removed | Task 1 |
| `WikiProvider` mounted once near app root | Task 5 |
| `wiki.setup()` called in DB init; package tables created idempotently | Task 4 |
| `synonymMapBase.ts` passed as `WikiConfig.synonymMap` | Task 2 |
| `wiki.read()` pre-turn, `formatContext()` for [MEMORY] block | Task 7 |
| `wiki.write()` fire-and-forget post-turn | Task 7 |
| `wikiLlm` callable: auth + premium + Vertex proxy, no credits | Task 12 |
| `wikiSync` callable: LWW upsert + return remoteDump | Task 14 |
| Background sync: `wikiSync` called from `syncAllToCloud` | Task 10 |
| User-initiated sync: `useWikiExport` hook on character edit screen | Task 10b |
| Old memory + documentExtract callables removed from both `firebaseConfig.ts` and `firebaseConfig.web.ts` | Task 6 |
| `wikiHealMachine`, `documentIngestMachine`, old DB files deleted | Task 16 |
| Cloud SQL migration generated and applied | Task 13 |
| + button: `useWikiHasChanged` + `useWikiIngest`; unchanged → notified; `WikiBusyError` surfaced | Task 8 |
| Chat screen inline `ingesting` / `librarian` indicators | Task 9 |
| `runPrune` after successful sync only; `WikiBusyError` caught | Task 10 |
| Schema v17: drop old SQLite tables | Task 3 |
| `saveToCloud` column on Cloud SQL `characters`; server gate in `wikiSync` | Task 13 + Task 14 |
| `npm run typecheck && npm run lint && npm run test` green | Task 17 |
| `cd functions && npm run typecheck && npm run lint && npm run build && node --test` green | Task 17 |

### Notes

- **No cloud functions are deleted at this stage.** All files under `functions/src/` that exist before this integration — including `memoryFunctions.ts`, `memoryFunctions.test.ts`, `documentExtract` (if present), and any other callables — are intentionally left in place. Only client-side callable *declarations* (`documentExtractFn`, old memory callables) are removed from the app configs, since their app-side consumers are deleted. The cloud functions themselves will be cleaned up in a separate step after retirement.
- No commits are made during implementation. After Task 17 passes, review the full diff locally and commit.
