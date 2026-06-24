# Phase 2 — Edge Agent Tool Execution Loop, Silent Ontology Bootstrap, Status UI Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the on-device edge agent tool-calling loop (re-pointed at the secured `generateReply` backend instead of a client-embedded Gemini key), extend it with two new graph/ontology tools, silently bootstrap every character into `emergent` ontology mode, and replace two of `ChatView`'s manual wiki-status conditions with the package's `useEntityStatus` hook.

**Architecture:** Client-side `useEdgeAgent`/`edgeToolExecutors` own the multi-turn tool loop and execute tools against local SQLite (`@equationalapplications/expo-llm-wiki`); the loop's only network calls are to the `generateReply` Firebase callable, extended to support `tools` and multi-round `functionCall`/`functionResponse` content. Ontology bootstrap happens lazily inside `wikiOrchestrator.getOrSpawn`. The cloud sync path (`wikiSync`) gains an `ontology` field so cloud-agent's Postgres-backed ontology read stays in sync with local SQLite.

**Tech Stack:** React Native / Expo, TypeScript, Firebase Cloud Functions (`onCall`), `@google/genai` (Vertex AI on the server only), `@equationalapplications/{core,react,expo}-llm-wiki`, XState, Jest (app) / `node:test` (functions).

**Important deviations from the spec doc** (`docs/superpowers/specs/2026-06-23-phase2-edge-loop-ontology-ui-design.md`), discovered during investigation — flagged inline in the relevant tasks too:

1. **Section 2 spec only described `getTextGenerator`'s inner loop, not `handler()`.** `handler()` calls `generateText(...)` and unconditionally does `generated.text.trim()`. That breaks when `generateText` returns `{ functionCalls }` instead of `{ text }`. Task 6 below fixes `handler()`'s branching, not just `getTextGenerator`.
2. **Section 2's "omit googleSearch when tools provided" logic needs to be unit-testable.** The existing test file never calls the real `getTextGenerator` (all tests inject a `generateText` override), so the omission logic is extracted into an exported `buildToolsForRequest()` function (mirroring the already-exported `toGenAITool`) so it can be tested directly. See Task 6.
3. **Section 3's Postgres sync logic assumed `localBundle.ontology` exists on `wiki.exportDump()`'s `MemoryDump`.** It does not — `@equationalapplications/core-llm-wiki`'s `MemoryBundle` type has no `ontology` field; ontology lives in a separate table reached only via `wiki.getOntologyManifest`/`setOntologyManifest`. Task 9 fetches/writes ontology directly via those two methods inside `useCharacterWiki.ts`'s `sync()`, not by reading it off the exported dump. Task 9 also extends `src/services/apiClient.ts`'s `WikiSyncRequest`/`WikiSyncResponse` types (not mentioned in the spec) because the package's strict `MemoryDump` type has no `ontology` field and TypeScript's excess-property check would reject a literal that adds one.

---

## Task 1: Add `@equationalapplications/core-llm-wiki` as an explicit dependency

**Files:**
- Modify: `package.json:37-38`

- [ ] **Step 1: Add the dependency**

In `package.json`, the dependencies block currently reads:

```json
    "@equationalapplications/core-llm-tools": "^4.17.0",
    "@equationalapplications/expo-llm-wiki": "4.17.0",
```

Add a line for `core-llm-wiki`, pinned exactly (no `^`) to match `expo-llm-wiki`'s existing pin style:

```json
    "@equationalapplications/core-llm-tools": "^4.17.0",
    "@equationalapplications/core-llm-wiki": "4.17.0",
    "@equationalapplications/expo-llm-wiki": "4.17.0",
```

- [ ] **Step 2: Install and verify**

Run: `npm install`
Expected: lockfile updates only for `@equationalapplications/core-llm-wiki` (it was already present transitively via `expo-llm-wiki`, so no new files should be downloaded — verify with `git diff package-lock.json` that the entry's `"dependencies"` or root listing changes but no version bump occurs).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add core-llm-wiki as an explicit dependency"
```

---

## Task 2: Add `wiki_get_ontology` and `wiki_traverse_graph` tool schemas

**Files:**
- Modify: `shared/agent-tools-spec.ts`

- [ ] **Step 1: Add the two schema entries**

In `shared/agent-tools-spec.ts`, insert the two new entries into the `agentToolSpec` array, immediately before the `set_reminder` entry (so the `'both'`/`'edge-only'` tools stay grouped):

```ts
  {
    name: 'wiki_get_ontology',
    tier: 'edge-only',
    description: "Retrieve the current ontology manifest (allowed node types and edge types) for the user's memory. Use this to understand the structure of the knowledge graph before traversing it.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'wiki_traverse_graph',
    tier: 'edge-only',
    description: 'Traverse the knowledge graph starting from a specific fact ID to discover connected concepts and relationships. Returns a formatted neighborhood subgraph.',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'The exact ID of the starting fact node (obtained from a previous wiki_read call).' },
        maxDepth: { type: 'integer', minimum: 1, maximum: 3, description: 'How many relationship hops to traverse. Maximum allowed is 3.' },
        direction: { type: 'string', enum: ['inbound', 'outbound', 'both'], description: "Direction of relationships to follow. Default 'both'." },
        edgeTypes: { type: 'array', items: { type: 'string' }, description: 'Optional filter. If provided, traversal only follows these edge types.' },
      },
      required: ['sourceId'],
    },
  },
  {
    name: 'set_reminder',
    tier: 'cloud-only',
    ...
```

(Only the two new objects are inserted — `set_reminder` and everything else stays unchanged.)

- [ ] **Step 2: Add a smoke test asserting the new tools are advertised to edge**

Find the existing tests for `shared/agent-tools-spec.ts`:

Run: `grep -rl "agent-tools-spec" --include="*.test.ts" .`

If a test file exists (e.g. `shared/agent-tools-spec.test.ts` or similar), add these cases there. If none exists, create `shared/agent-tools-spec.test.ts`:

```ts
import { agentToolSpec, getSchemasForEdge, getSchemasForCloud } from './agent-tools-spec'

describe('agent-tools-spec', () => {
  it('includes wiki_get_ontology and wiki_traverse_graph as edge-only tools', () => {
    const ontologyTool = agentToolSpec.find((t) => t.name === 'wiki_get_ontology')
    const traverseTool = agentToolSpec.find((t) => t.name === 'wiki_traverse_graph')
    expect(ontologyTool?.tier).toBe('edge-only')
    expect(traverseTool?.tier).toBe('edge-only')
  })

  it('getSchemasForEdge includes the new graph tools regardless of wiki/cloud-sync flags', () => {
    const names = getSchemasForEdge(true, true).map((t) => t.name)
    expect(names).toContain('wiki_get_ontology')
    expect(names).toContain('wiki_traverse_graph')
  })

  it('getSchemasForCloud does not include the edge-only graph tools', () => {
    const names = getSchemasForCloud().map((t) => t.name)
    expect(names).not.toContain('wiki_get_ontology')
    expect(names).not.toContain('wiki_traverse_graph')
  })

  it('wiki_traverse_graph requires sourceId', () => {
    const traverseTool = agentToolSpec.find((t) => t.name === 'wiki_traverse_graph')
    expect(traverseTool?.parameters.required).toEqual(['sourceId'])
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npm test -- agent-tools-spec`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add shared/agent-tools-spec.ts shared/agent-tools-spec.test.ts
git commit -m "feat(shared): add wiki_get_ontology and wiki_traverse_graph tool schemas"
```

---

## Task 3: Restore `src/services/edgeToolExecutors.ts` with the two new graph executors

**Files:**
- Create: `src/services/edgeToolExecutors.ts`
- Create: `src/services/__tests__/edgeToolExecutors.test.ts`

- [ ] **Step 1: Write the test file first**

Create `src/services/__tests__/edgeToolExecutors.test.ts`:

```ts
import { edgeToolExecutors, createEdgeToolExecutors } from '../edgeToolExecutors'
import { readFromWiki, writeToWiki } from '../wikiService'
import { createTask, listTasks, updateTask, completeTask, deleteTask } from '../../database/taskDatabase'
import type { LocalTask } from '../../database/taskDatabase'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'

jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
  writeToWiki: jest.fn(),
}))

jest.mock('../../database/taskDatabase', () => ({
  createTask: jest.fn(),
  listTasks: jest.fn(),
  updateTask: jest.fn(),
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
}))

jest.mock('@equationalapplications/core-llm-wiki', () => ({
  formatGraphContext: jest.fn(() => 'formatted graph context'),
}))

const mockReadFromWiki = readFromWiki as jest.Mock
const mockWriteToWiki = writeToWiki as jest.Mock
const mockCreateTask = createTask as jest.Mock
const mockListTasks = listTasks as jest.Mock
const mockUpdateTask = updateTask as jest.Mock
const mockCompleteTask = completeTask as jest.Mock
const mockDeleteTask = deleteTask as jest.Mock
const mockFormatGraphContext = formatGraphContext as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('edgeToolExecutors (static map)', () => {
  it('get_current_time is present and returns a string containing a year', () => {
    expect(typeof edgeToolExecutors['get_current_time']).toBe('function')
    const result = edgeToolExecutors['get_current_time']({}) as string
    expect(result).toMatch(/\d{4}/)
  })
})

describe('createEdgeToolExecutors — wiki_read', () => {
  it('returns "No relevant memories found." when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_read']({ query: 'anything' })
    expect(result).toBe('No relevant memories found.')
    expect(mockReadFromWiki).not.toHaveBeenCalled()
  })

  it('returns JSON string when wiki returns facts', async () => {
    const mockResults = { facts: [{ content: 'User likes coffee' }], tasks: [], events: [] }
    mockReadFromWiki.mockResolvedValue(mockResults)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_read']({ query: 'coffee' })
    expect(result).toBe(JSON.stringify(mockResults))
  })

  it('returns "No relevant memories found." when readFromWiki throws', async () => {
    mockReadFromWiki.mockRejectedValue(new Error('SQLite locked'))
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_read']({ query: 'coffee' })
    expect(result).toBe('No relevant memories found.')
  })
})

describe('createEdgeToolExecutors — wiki_write', () => {
  it('returns failure message when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_write']({ summary: 'User likes tea' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('calls writeToWiki and returns success message', async () => {
    mockWriteToWiki.mockResolvedValue(undefined)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-42', wiki)
    const result = await execs['wiki_write']({ summary: 'User prefers dark mode' })
    expect(mockWriteToWiki).toHaveBeenCalledWith(wiki, 'char-42', {
      event_type: 'observation',
      summary: 'User prefers dark mode',
    })
    expect(result).toBe('Observation recorded successfully.')
  })

  it('returns internal error message when writeToWiki throws', async () => {
    mockWriteToWiki.mockRejectedValue(new Error('SQLite locked'))
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_write']({ summary: 'User likes jazz' })
    expect(result).toBe('Failed to record observation due to an internal error.')
  })
})

describe('createEdgeToolExecutors — create_task / list_tasks', () => {
  it('create_task returns failure message when title is missing', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({})
    expect(result).toBe('Failed to create task: title is required.')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('create_task returns JSON with taskId on success', async () => {
    mockCreateTask.mockResolvedValue('task_123')
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: 'Buy milk' })
    expect(result).toBe(JSON.stringify({ taskId: 'task_123', title: 'Buy milk' }))
  })

  it('list_tasks returns "No tasks found." when list is empty', async () => {
    mockListTasks.mockResolvedValue([])
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    expect(result).toBe('No tasks found.')
  })

  it('list_tasks returns JSON with open tasks', async () => {
    const tasks: LocalTask[] = [
      { id: 'task_1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
    ]
    mockListTasks.mockResolvedValue(tasks)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    const parsed = JSON.parse(result as string)
    expect(parsed[0]).toEqual({ id: 'task_1', title: 'Buy milk', status: 'open' })
  })
})

describe('createEdgeToolExecutors — update_task / complete_task / delete_task', () => {
  it('update_task requires taskId and title', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['update_task']({ taskId: 'x' })
    expect(result).toBe('Failed to update task: taskId and title are required.')
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('update_task calls updateTask and returns confirmation', async () => {
    mockUpdateTask.mockResolvedValue(undefined)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['update_task']({ taskId: 'task_1', title: 'Buy oat milk' })
    expect(mockUpdateTask).toHaveBeenCalledWith('char-1', 'task_1', 'Buy oat milk')
    expect(result).toBe('Task updated.')
  })

  it('complete_task requires taskId', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['complete_task']({})
    expect(result).toBe('Failed to complete task: taskId is required.')
    expect(mockCompleteTask).not.toHaveBeenCalled()
  })

  it('complete_task calls completeTask and returns confirmation', async () => {
    mockCompleteTask.mockResolvedValue(undefined)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['complete_task']({ taskId: 'task_1' })
    expect(mockCompleteTask).toHaveBeenCalledWith('char-1', 'task_1')
    expect(result).toBe('Task marked as completed.')
  })

  it('delete_task requires taskId', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['delete_task']({})
    expect(result).toBe('Failed to delete task: taskId is required.')
    expect(mockDeleteTask).not.toHaveBeenCalled()
  })

  it('delete_task calls deleteTask and returns confirmation', async () => {
    mockDeleteTask.mockResolvedValue(undefined)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['delete_task']({ taskId: 'task_1' })
    expect(mockDeleteTask).toHaveBeenCalledWith('char-1', 'task_1')
    expect(result).toBe('Task deleted.')
  })
})

describe('createEdgeToolExecutors — document_search (placeholder)', () => {
  it('returns the not-yet-available placeholder message', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['document_search']({ query: 'invoice' })
    expect(result).toBe('Document search is not yet available on device.')
  })
})

describe('createEdgeToolExecutors — set_reminder (escalation phantom tool)', () => {
  it('returns the ESCALATE_TO_CLOUD_AGENT sentinel', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['set_reminder']({})
    expect(result).toBe('ESCALATE_TO_CLOUD_AGENT')
  })
})

describe('createEdgeToolExecutors — wiki_get_ontology', () => {
  it('returns { mode: "off", manifest: null } when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_get_ontology']({})
    expect(result).toBe(JSON.stringify({ mode: 'off', manifest: null }))
  })

  it('returns the resolved manifest when wiki has one', async () => {
    const manifest = { mode: 'emergent', manifest: { node_types: [], edge_types: [] } }
    const wiki = { getOntologyManifest: jest.fn().mockResolvedValue(manifest) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_get_ontology']({})
    expect(wiki.getOntologyManifest).toHaveBeenCalledWith('char-1')
    expect(result).toBe(JSON.stringify(manifest))
  })

  it('returns { mode: "off", manifest: null } when wiki has no manifest', async () => {
    const wiki = { getOntologyManifest: jest.fn().mockResolvedValue(null) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_get_ontology']({})
    expect(result).toBe(JSON.stringify({ mode: 'off', manifest: null }))
  })

  it('returns the off fallback when getOntologyManifest throws', async () => {
    const wiki = { getOntologyManifest: jest.fn().mockRejectedValue(new Error('locked')) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_get_ontology']({})
    expect(result).toBe(JSON.stringify({ mode: 'off', manifest: null }))
  })
})

describe('createEdgeToolExecutors — wiki_traverse_graph', () => {
  it('requires sourceId', async () => {
    const wiki = { traverseGraph: jest.fn() } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_traverse_graph']({})
    expect(result).toBe('Failed to traverse graph: sourceId is required.')
    expect(wiki.traverseGraph).not.toHaveBeenCalled()
  })

  it('returns a failure message when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['wiki_traverse_graph']({ sourceId: 'fact-1' })
    expect(result).toBe('Failed to traverse graph: sourceId is required.')
  })

  it('calls wiki.traverseGraph with parsed options and formats the result', async () => {
    const neighborhood = { nodes: [], edges: [] }
    const wiki = { traverseGraph: jest.fn().mockResolvedValue(neighborhood) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_traverse_graph']({
      sourceId: 'fact-1',
      maxDepth: 2,
      direction: 'outbound',
      edgeTypes: ['relates_to'],
    })
    expect(wiki.traverseGraph).toHaveBeenCalledWith('char-1', {
      sourceId: 'fact-1',
      maxDepth: 2,
      direction: 'outbound',
      edgeTypes: ['relates_to'],
    })
    expect(mockFormatGraphContext).toHaveBeenCalledWith(neighborhood)
    expect(result).toBe('formatted graph context')
  })

  it('returns an internal-error message when wiki.traverseGraph throws', async () => {
    const wiki = { traverseGraph: jest.fn().mockRejectedValue(new Error('busy')) } as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['wiki_traverse_graph']({ sourceId: 'fact-1' })
    expect(result).toBe('Failed to traverse graph due to an internal error.')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- edgeToolExecutors`
Expected: FAIL — `Cannot find module '../edgeToolExecutors'`

- [ ] **Step 3: Restore the implementation with the two new executors added**

Create `src/services/edgeToolExecutors.ts`:

```ts
import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'
import { createTask, listTasks, updateTask, completeTask, deleteTask } from '~/database/taskDatabase'
import type { LocalTask } from '~/database/taskDatabase'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'

export type ToolExecutor = (args: Record<string, unknown>) => unknown | Promise<unknown>

export const edgeToolExecutors: Record<string, ToolExecutor> = {
  get_current_time: () =>
    new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
}

export function createEdgeToolExecutors(characterId: string, wiki: Wiki | null): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    wiki_read: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'
        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories = results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_read failed:', error)
        return 'No relevant memories found.'
      }
    },
    wiki_write: async (args) => {
      try {
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (!wiki || !summary) return 'Failed to record observation: Invalid input or missing database.'
        await writeToWiki(wiki, characterId, { event_type: 'observation', summary })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[EdgeAgent] wiki_write failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
    create_task: async (args) => {
      try {
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!title) return 'Failed to create task: title is required.'
        const taskId = await createTask(characterId, title)
        return JSON.stringify({ taskId, title })
      } catch (error) {
        console.error('[EdgeAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
    },
    list_tasks: async () => {
      try {
        const tasks = await listTasks(characterId)
        const open = tasks.filter((t: LocalTask) => t.status === 'pending' || t.status === 'open')
        if (open.length === 0) return 'No tasks found.'
        return JSON.stringify(open.map((t: LocalTask) => ({ id: t.id, title: t.title, status: 'open' })))
      } catch (error) {
        console.error('[EdgeAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
    update_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!taskId || !title) return 'Failed to update task: taskId and title are required.'
        await updateTask(characterId, taskId, title)
        return 'Task updated.'
      } catch (error) {
        console.error('[EdgeAgent] update_task failed:', error)
        return 'Failed to update task due to an internal error.'
      }
    },
    complete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to complete task: taskId is required.'
        await completeTask(characterId, taskId)
        return 'Task marked as completed.'
      } catch (error) {
        console.error('[EdgeAgent] complete_task failed:', error)
        return 'Failed to complete task due to an internal error.'
      }
    },
    delete_task: async (args) => {
      try {
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
        if (!taskId) return 'Failed to delete task: taskId is required.'
        await deleteTask(characterId, taskId)
        return 'Task deleted.'
      } catch (error) {
        console.error('[EdgeAgent] delete_task failed:', error)
        return 'Failed to delete task due to an internal error.'
      }
    },
    document_search: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!query) return 'No results found.'
        // Local document search — implementation deferred
        return 'Document search is not yet available on device.'
      } catch (error) {
        console.error('[EdgeAgent] document_search failed:', error)
        return 'Failed to search documents due to an internal error.'
      }
    },
    set_reminder: async () => {
      // This is a phantom tool that exists only to force escalation.
      // The edge agent will see this tool and its description, and call it for reminders.
      // The useEdgeAgent hook will see the 'ESCALATE_TO_CLOUD_AGENT' output and escalate.
      return 'ESCALATE_TO_CLOUD_AGENT'
    },
    wiki_get_ontology: async () => {
      if (!wiki) return JSON.stringify({ mode: 'off', manifest: null })
      try {
        const result = await wiki.getOntologyManifest(characterId)
        return JSON.stringify(result ?? { mode: 'off', manifest: null })
      } catch (error) {
        console.error('[EdgeAgent] wiki_get_ontology failed:', error)
        return JSON.stringify({ mode: 'off', manifest: null })
      }
    },
    wiki_traverse_graph: async (args) => {
      try {
        const sourceId = typeof args.sourceId === 'string' ? args.sourceId.trim() : ''
        if (!wiki || !sourceId) return 'Failed to traverse graph: sourceId is required.'
        const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : undefined
        const direction = args.direction as 'inbound' | 'outbound' | 'both' | undefined
        const edgeTypes = Array.isArray(args.edgeTypes) ? args.edgeTypes as string[] : undefined
        const neighborhood = await wiki.traverseGraph(characterId, { sourceId, maxDepth, direction, edgeTypes })
        return formatGraphContext(neighborhood)
      } catch (error) {
        console.error('[EdgeAgent] wiki_traverse_graph failed:', error)
        return 'Failed to traverse graph due to an internal error.'
      }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- edgeToolExecutors`
Expected: PASS (all `describe` blocks above)

- [ ] **Step 5: Commit**

```bash
git add src/services/edgeToolExecutors.ts src/services/__tests__/edgeToolExecutors.test.ts
git commit -m "feat(edge): restore edgeToolExecutors with wiki_get_ontology and wiki_traverse_graph"
```

---

## Task 4: `generateReply.ts` — accept `tools` and richer `contents` in the request

**Files:**
- Modify: `functions/src/generateReply.ts`
- Modify: `functions/src/generateReply.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/generateReply.test.ts` (after the existing `"generateReplyHandler rejects malformed structured contents items"` test, before the closing of that test block's file):

```ts
test("generateReplyHandler rejects tools with an unrecognized name", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
              systemInstruction: 'You are a helpful assistant.',
              tools: [{ name: 'delete_everything', description: 'Bad tool', parameters: { type: 'object', properties: {} } }],
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );
  });
});

test("generateReplyHandler accepts recognized tools and forwards them to generateText", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const tools = [{ name: 'get_current_time', description: 'Get the time', parameters: { type: 'object', properties: {} } }];
    let receivedTools: unknown;

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
          systemInstruction: 'You are a helpful assistant.',
          tools,
        },
      } as never,
      {
        generateText: async (input) => {
          receivedTools = input.tools;
          return { text: 'It is noon.' };
        },
      }
    );

    assert.deepEqual(receivedTools, tools);
    assert.equal(result.reply, 'It is noon.');
  });
});

test("generateReplyHandler accepts contents with functionCall and functionResponse parts", async () => {
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
        data: {
          contents: [
            { role: 'user', parts: [{ text: 'what time is it' }] },
            { role: 'model', parts: [{ functionCall: { name: 'get_current_time', args: {} } }] },
            { role: 'user', parts: [{ functionResponse: { name: 'get_current_time', response: { output: 'noon' } } }] },
          ],
          systemInstruction: 'You are a helpful assistant.',
        },
      } as never,
      {
        generateText: async () => ({ text: 'It is noon.' }),
      }
    );

    assert.equal(result.reply, 'It is noon.');
  });
});

test("generateReplyHandler rejects a contents part with neither text, functionCall, nor functionResponse", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    await assert.rejects(
      async () =>
        generateReplyHandler(
          {
            auth,
            data: {
              contents: [{ role: 'model', parts: [{ functionCall: { args: {} } }] }],
              systemInstruction: 'You are a helpful assistant.',
            },
          } as never,
          {
            generateText: async () => ({ text: 'unused' }),
          }
        ),
      (err: unknown) => err instanceof HttpsError && err.code === 'invalid-argument',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npm test`
Expected: FAIL — `tools` is silently dropped (not validated, not forwarded) and the new compile of `generateReplyHandler` type won't accept `tools` in `data` (TS error) or `receivedTools` stays `undefined`; the functionCall/functionResponse content tests fail with `invalid-argument: contents[1].parts[0] must be an object with a text string.`

- [ ] **Step 3: Implement the allow-list, `tools` parsing, and `validateStructuredContents` update**

In `functions/src/generateReply.ts`, add the allow-list constant near the top (after the existing top-level constants, e.g. after `MAX_STRUCTURED_PAYLOAD_SIZE`):

```ts
// Mirrors the 'both' + 'edge-only' tier tool names from shared/agent-tools-spec.ts.
// Hardcoded rather than imported: functions/'s tsconfig.json has rootDir: "src" and
// cannot reach the repo-root shared/ directory without restructuring its build. The
// client already builds the schema array itself via getSchemasForEdge() and sends it
// as data, so the server only needs to defend against unexpected tool *names*.
const ALLOWED_TOOL_NAMES = new Set([
  "get_current_time",
  "wiki_read",
  "wiki_write",
  "create_task",
  "list_tasks",
  "update_task",
  "complete_task",
  "delete_task",
  "document_search",
  "escalate_to_cloud_agent",
  "wiki_get_ontology",
  "wiki_traverse_graph",
]);

interface ToolDeclaration {
  name: string;
  description: string;
  parameters: object;
}
```

Replace `validateStructuredContents`'s inner part-validation loop (the block from `for (const [partIndex, part] of parts.entries()) {` through its closing `}`) with one that also accepts `functionCall`/`functionResponse` parts:

```ts
    for (const [partIndex, part] of parts.entries()) {
      if (!isPlainObject(part)) {
        throw new HttpsError(
          "invalid-argument",
          `contents[${index}].parts[${partIndex}] must be an object with a text string, functionCall, or functionResponse.`,
        );
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") {
        continue;
      }

      const functionCall = (part as { functionCall?: unknown }).functionCall;
      if (isPlainObject(functionCall) && typeof (functionCall as { name?: unknown }).name === "string") {
        continue;
      }

      const functionResponse = (part as { functionResponse?: unknown }).functionResponse;
      if (
        isPlainObject(functionResponse) &&
        typeof (functionResponse as { name?: unknown }).name === "string" &&
        isPlainObject((functionResponse as { response?: unknown }).response)
      ) {
        continue;
      }

      throw new HttpsError(
        "invalid-argument",
        `contents[${index}].parts[${partIndex}] must be an object with a text string, functionCall, or functionResponse.`,
      );
    }
```

Add a `validateTools` function near `validateStructuredContents`:

```ts
function validateTools(tools: unknown[]): ToolDeclaration[] {
  return tools.map((tool, index) => {
    if (!isPlainObject(tool)) {
      throw new HttpsError("invalid-argument", `tools[${index}] must be an object.`);
    }
    const t = tool as Record<string, unknown>;
    if (typeof t.name !== "string" || typeof t.description !== "string" || !isPlainObject(t.parameters)) {
      throw new HttpsError(
        "invalid-argument",
        `tools[${index}] must have a string name, string description, and object parameters.`,
      );
    }
    if (!ALLOWED_TOOL_NAMES.has(t.name)) {
      throw new HttpsError("invalid-argument", `tools[${index}].name "${t.name}" is not a recognized tool.`);
    }
    return { name: t.name, description: t.description, parameters: t.parameters as object };
  });
}
```

Add `tools?: ToolDeclaration[]` to `GenerateReplyData` (right after `systemInstruction?: string;`):

```ts
interface GenerateReplyData {
  characterId?: string;
  prompt?: string;
  contents?: unknown[];
  systemInstruction?: string;
  tools?: unknown[];
  unsyncedHistory?: SyncMessage[];
  referenceId?: string;
}
```

In `parseInput`, add tools parsing (after the `contents`-parsing block, before the `systemInstructionValue` block):

```ts
  const toolsValue = payload?.tools;
  let tools: ToolDeclaration[] | undefined;
  if (toolsValue !== undefined) {
    if (!Array.isArray(toolsValue)) {
      throw new HttpsError("invalid-argument", "tools must be an array when provided.");
    }
    tools = validateTools(toolsValue);
  }
```

Add `tools` to `parseInput`'s return type and return statement:

```ts
function parseInput(data: unknown): {
  prompt?: string;
  contents?: unknown[];
  systemInstruction?: string;
  tools?: ToolDeclaration[];
  characterId?: string;
  unsyncedHistory?: SyncMessage[];
  referenceId?: string;
} {
```

```ts
  return { prompt, contents, systemInstruction, tools, characterId, unsyncedHistory, referenceId };
```

And destructure it in `handler()`:

```ts
  const parsed = parseInput(request.data);
  const { prompt, characterId, unsyncedHistory, contents, systemInstruction, tools } = parsed;
```

(`tools` is wired into `generateText(...)` in Task 6, once `GenerateTextFn`'s signature is extended.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS for the four new tests (the "accepts recognized tools" test will still fail until Task 6 wires `tools` into the `generateText` call — confirm it fails with `receivedTools` being `undefined` rather than a different error, then proceed; it will go green at the end of Task 6's Step 4).

- [ ] **Step 5: Commit**

```bash
git add functions/src/generateReply.ts functions/src/generateReply.test.ts
git commit -m "feat(functions): validate tools allow-list and accept functionCall/functionResponse content parts in generateReply"
```

---

## Task 5: `generateReply.ts` — extract `buildToolsForRequest` and surface `functionCalls` from `getTextGenerator`

**Files:**
- Modify: `functions/src/generateReply.ts`
- Modify: `functions/src/generateReply.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/generateReply.test.ts`, near the existing `toGenAITool` tests:

```ts
test("buildToolsForRequest falls back to googleSearch when no tools are provided", () => {
  const result = buildToolsForRequest(undefined);
  assert.deepEqual(result, [{ googleSearch: {} }]);
});

test("buildToolsForRequest uses provided functionDeclarations and omits googleSearch when tools are present", () => {
  const tools = [{ name: "get_current_time", description: "Get the time", parameters: { type: "object", properties: {} } }];
  const result = buildToolsForRequest(tools);
  assert.deepEqual(result, [{ functionDeclarations: tools }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — `buildToolsForRequest is not defined` (not exported from `generateReply.ts` yet)

- [ ] **Step 3: Extract `buildToolsForRequest` and update `getTextGenerator`**

In `functions/src/generateReply.ts`, add a new exported function right after `toGenAITool`:

```ts
export function buildToolsForRequest(tools?: ToolDeclaration[]): Tool[] {
  if (tools && tools.length > 0) {
    return [{ functionDeclarations: tools as Tool['functionDeclarations'] }];
  }
  return buildAuthorizedToolsArray([googleSearchManifest], []).map(toGenAITool);
}
```

Replace the `GenerateTextFn` type and `getTextGenerator`'s body. The current type:

```ts
type GenerateTextFn = (input: {
  contents: unknown[];
  systemInstruction: string;
}) => Promise<{ text: string; groundingMetadata?: GroundingMetadata }>;
```

becomes:

```ts
type GenerateTextResult =
  | { text: string; groundingMetadata?: GroundingMetadata; functionCalls?: undefined }
  | { functionCalls: { name: string; args?: Record<string, unknown> }[]; text?: undefined; groundingMetadata?: undefined };

type GenerateTextFn = (input: {
  contents: unknown[];
  systemInstruction: string;
  tools?: ToolDeclaration[];
}) => Promise<GenerateTextResult>;
```

And `getTextGenerator`'s body (the assignment to `textGenerator`):

```ts
  textGenerator = async (input: {
    contents: unknown[];
    systemInstruction: string;
    tools?: ToolDeclaration[];
  }) => {
    const ai = getGenAIClient();
    const tools = buildToolsForRequest(input.tools);

    const result = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: input.contents as Content[],
      config: {
        systemInstruction: input.systemInstruction,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
        tools,
      },
    });

    if (result.functionCalls && result.functionCalls.length > 0) {
      return { functionCalls: result.functionCalls };
    }

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS for the two new `buildToolsForRequest` tests. The full suite will still fail to compile until Task 6 updates `handler()` to match the new `GenerateTextFn`/`GenerateTextResult` shape — proceed directly to Task 6 before running the full suite again.

- [ ] **Step 5: Commit**

```bash
git add functions/src/generateReply.ts functions/src/generateReply.test.ts
git commit -m "feat(functions): extract buildToolsForRequest and surface functionCalls from getTextGenerator"
```

---

## Task 6: `generateReply.ts` — branch `handler()` on `functionCalls` vs `text`, wire `tools` through

**Files:**
- Modify: `functions/src/generateReply.ts`
- Modify: `functions/src/generateReply.test.ts`

This task fixes the gap the spec document left implicit (see "Important deviations" #1 at the top of this plan): `handler()` itself, not just `getTextGenerator`, must branch on the new `GenerateTextResult` union.

- [ ] **Step 1: Write the failing test**

Add to `functions/src/generateReply.test.ts`:

```ts
test("generateReplyHandler returns functionCalls instead of throwing on an empty text response", async () => {
  const auth = buildAuth();

  await withServiceMocks(async () => {
    const user = buildUser(auth);

    userRepository.getOrCreateUserByFirebaseIdentity = async () => user;
    subscriptionService.getSubscription = async () => buildSubscription(user.id, "payg", 3);
    creditService.spendCredits = async () => 'mock-tx-id';
    creditService.getCredits = async () => 2;

    const functionCalls = [{ name: 'get_current_time', args: {} }];

    const result = await generateReplyHandler(
      {
        auth,
        data: {
          contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
          systemInstruction: 'You are a helpful assistant.',
          tools: [{ name: 'get_current_time', description: 'Get the time', parameters: { type: 'object', properties: {} } }],
        },
      } as never,
      {
        generateText: async () => ({ functionCalls }),
      }
    );

    assert.deepEqual(result.functionCalls, functionCalls);
    assert.equal(result.reply, '');
    assert.equal(result.creditsSpent, 1);
    assert.equal(result.remainingCredits, 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL with a `TypeError` (`Cannot read properties of undefined (reading 'trim')`), since `handler()` still does `generated.text.trim()` unconditionally.

- [ ] **Step 3: Update `GenerateReplyResponse`, wire `tools` into the call, and branch on the result**

Add `functionCalls?: { name: string; args?: Record<string, unknown> }[];` to `GenerateReplyResponse`:

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
  functionCalls?: { name: string; args?: Record<string, unknown> }[];
}
```

Destructure `tools` from `parsed` in `handler()` (already added to `parsed` in Task 4 — just add it to the existing destructure line):

```ts
  const { prompt, characterId, unsyncedHistory, contents, systemInstruction, tools } = parsed;
```

Replace the body of the `try` block inside `handler()` (from `const generated = await generateText(...)` through the `return { reply, ... }` statement) with:

```ts
    const generated = await generateText({
      contents: contents ?? [],
      systemInstruction: systemInstruction ?? '',
      tools,
    });

    if (generated.functionCalls && generated.functionCalls.length > 0) {
      const usageSnapshot = await buildUsageSnapshotForUser(
        user.id,
        subscriptionService,
        'generateReply'
      );

      return {
        reply: '',
        functionCalls: generated.functionCalls,
        creditsSpent: 1,
        remainingCredits,
        ...usageSnapshot,
      };
    }

    reply = (generated.text ?? '').trim();
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

- [ ] **Step 4: Run the full functions test suite**

Run: `cd functions && npm test`
Expected: PASS — including the "accepts recognized tools and forwards them to generateText" test from Task 4 (now that `tools` is actually passed to `generateText`), and the new functionCalls test from this task.

- [ ] **Step 5: Commit**

```bash
git add functions/src/generateReply.ts functions/src/generateReply.test.ts
git commit -m "feat(functions): branch generateReply handler on functionCalls vs text responses"
```

---

## Task 7: `chatReplyService.ts` — client-side `tools`/`functionCalls` passthrough

**Files:**
- Modify: `src/services/chatReplyService.ts`
- Modify: `__tests__/chatReplyService.test.ts`

This implements spec Section 2's "Client-side wiring" and the "Response shape from `generateChatReply` gains an optional `functionCalls`" line from Section 1.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/chatReplyService.test.ts`:

```ts
  it('forwards tools to the callable payload when provided', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: '',
        functionCalls: [{ name: 'get_current_time', args: {} }],
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const tools = [{ name: 'get_current_time', description: 'Get the time', parameters: { type: 'object', properties: {} } }]
    const resultPromise = generateChatReply({
      contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
      systemInstruction: 'Be concise.',
      tools,
    })

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).resolves.toEqual({
      reply: '',
      remainingCredits: null,
      planTier: null,
      planStatus: null,
      verifiedAt: '2026-01-01T00:00:00.000Z',
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })
    expect(mockGenerateReplyFn).toHaveBeenCalledWith({
      contents: [{ role: 'user', parts: [{ text: 'what time is it' }] }],
      systemInstruction: 'Be concise.',
      tools,
    })
  })

  it('does not require a non-empty reply when functionCalls are present', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: {
        reply: '',
        functionCalls: [{ name: 'wiki_read', args: { query: 'coffee' } }],
        verifiedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const resultPromise = generateChatReply({
      contents: [{ role: 'user', parts: [{ text: 'what do I like to drink' }] }],
      systemInstruction: 'Be concise.',
    })

    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    const result = await resultPromise
    expect(result.functionCalls).toEqual([{ name: 'wiki_read', args: { query: 'coffee' } }])
  })

  it('still rejects an empty reply when functionCalls are absent', async () => {
    mockGenerateReplyFn.mockResolvedValue({
      data: { reply: '', verifiedAt: '2026-01-01T00:00:00.000Z' },
    })

    const resultPromise = generateChatReply({ prompt: 'hello' })
    if (!resolveAppCheck) {
      throw new Error('Expected appCheckReady resolver to be set')
    }
    resolveAppCheck()

    await expect(resultPromise).rejects.toThrow('Invalid generateReply response payload')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- chatReplyService`
Expected: FAIL — `tools` is not part of `GenerateChatReplyInput` (TS error / payload mismatch), and `data.reply` being `''` currently throws unconditionally regardless of `functionCalls`.

- [ ] **Step 3: Implement the passthrough**

In `src/services/chatReplyService.ts`, add `tools` to `GenerateChatReplyInput`:

```ts
interface GenerateChatReplyInput {
  prompt?: string
  contents?: unknown[]
  systemInstruction?: string
  referenceId?: string
  unsyncedHistory?: SyncMessage[]
  characterId?: string  // forwarded to Firebase for bulk insert
  tools?: { name: string; description: string; parameters: object }[]
}
```

Add `functionCalls?: { name: string; args?: Record<string, unknown> }[]` to both `GenerateReplyCallableResponse` and `GenerateChatReplyResult`:

```ts
interface GenerateReplyCallableResponse {
  reply: string
  remainingCredits?: number | null
  planTier?: string | null
  planStatus?: 'active' | 'cancelled' | 'expired' | null
  verifiedAt?: string
  groundingMetadata?: unknown
  functionCalls?: { name: string; args?: Record<string, unknown> }[]
}

export interface GenerateChatReplyResult {
  reply: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
  groundingMetadata?: GroundingMetadata
  functionCalls?: { name: string; args?: Record<string, unknown> }[]
}
```

Update the destructure and payload-building in `generateChatReply` to add `tools`:

```ts
export async function generateChatReply({
  prompt,
  contents,
  systemInstruction,
  referenceId,
  unsyncedHistory,
  characterId,
  tools,
}: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
```

```ts
  if (tools !== undefined) {
    payload.tools = tools
  }
```

(Insert this right after the existing `if (typeof systemInstruction === 'string') { payload.systemInstruction = ... }` block.)

Finally, update the response validation and return statement to tolerate an empty `reply` when `functionCalls` is present:

```ts
  const data = result.data as GenerateReplyCallableResponse
  const functionCalls = Array.isArray(data?.functionCalls) && data.functionCalls.length > 0
    ? data.functionCalls
    : undefined

  if (!functionCalls && (!data?.reply || typeof data.reply !== 'string')) {
    throw new Error('Invalid generateReply response payload')
  }
  const verifiedAt = typeof data.verifiedAt === 'string' ? data.verifiedAt.trim() : ''
  if (!verifiedAt) {
    throw new Error('Invalid generateReply response payload: missing verifiedAt')
  }

  return {
    reply: typeof data.reply === 'string' ? data.reply.trim() : '',
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
    functionCalls,
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- chatReplyService`
Expected: PASS (all existing tests still pass — `toEqual` ignores the new `functionCalls: undefined` key on old fixtures; the three new tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/services/chatReplyService.ts __tests__/chatReplyService.test.ts
git commit -m "feat(chat): pass tools through generateChatReply and surface functionCalls in its response"
```

---

## Task 8: Restore `src/hooks/useEdgeAgent.ts` on top of `generateChatReply`

**Files:**
- Modify: `src/hooks/useEdgeAgent.ts`
- Modify: `src/hooks/__tests__/useEdgeAgent.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/hooks/__tests__/useEdgeAgent.test.ts` with:

```ts
import { renderHook, act } from '@testing-library/react-native'
import { useEdgeAgent } from '../useEdgeAgent'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'
import type { IMessage } from 'react-native-gifted-chat'

const mockGenerateChatReply = jest.fn()
jest.mock('~/services/chatReplyService', () => ({
  generateChatReply: (...args: unknown[]) => mockGenerateChatReply(...args),
}))

jest.mock('~/services/clankerManifests', () => ({
  getSchemasForEdge: jest.fn((hasWiki: boolean, isCloudSynced: boolean) => {
    const schemas = [
      { name: 'get_current_time', description: 'Get current time', parameters: { type: 'object', properties: {}, required: [] } },
      { name: 'set_reminder', description: 'Set a reminder', parameters: { type: 'object', properties: {}, required: [] } },
    ]
    if (hasWiki) {
      schemas.push({ name: 'wiki_read', description: 'Search memory', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } as never)
    }
    if (!isCloudSynced) {
      return schemas.filter((s) => s.name !== 'escalate_to_cloud_agent')
    }
    return schemas
  }),
}))

const mockExecutors = {
  get_current_time: jest.fn(() => 'Thursday, May 28, 2026 at 10:00 AM PDT'),
  wiki_read: jest.fn(async () => JSON.stringify({ facts: [{ content: 'User likes tea' }], tasks: [], events: [] })),
  set_reminder: jest.fn(async () => 'ESCALATE_TO_CLOUD_AGENT'),
}
jest.mock('~/services/edgeToolExecutors', () => ({
  createEdgeToolExecutors: jest.fn(() => mockExecutors),
}))

jest.mock('~/services/CharacterPromptBuilder', () => ({
  buildSystemInstruction: () => 'You are Aria.',
  buildContentHistory: () => [],
}))

const character = {
  id: 'char-1',
  name: 'Aria',
  appearance: 'warm',
  traits: 'kind',
  emotions: 'gentle',
  context: '',
}

const priorMessages: IMessage[] = []

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useEdgeAgent', () => {
  it('returns escalated:false and text when the model returns a text reply with no functionCalls', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: 'Hello! How are you?', functionCalls: undefined })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: false, text: 'Hello! How are you?' })
    expect(result.current.escalationState).toBe('idle')
  })

  it('executes get_current_time and loops to a final text reply', async () => {
    mockGenerateChatReply
      .mockResolvedValueOnce({ reply: '', functionCalls: [{ name: 'get_current_time', args: {} }] })
      .mockResolvedValueOnce({ reply: 'It is Thursday.', functionCalls: undefined })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What time is it?')
    })

    expect(response).toEqual({ escalated: false, text: 'It is Thursday.' })
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(2)
    expect(mockExecutors.get_current_time).toHaveBeenCalledWith({})
  })

  it('escalates when the set_reminder phantom tool fires (ESCALATE_TO_CLOUD_AGENT sentinel)', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: '', functionCalls: [{ name: 'set_reminder', args: {} }] })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Remind me to call mom tomorrow')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
  })

  it('escalates automatically when MAX_ITERATIONS (5) is reached for cloud-synced characters', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: '', functionCalls: [{ name: 'get_current_time', args: {} }] })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(5)
  })

  it('returns no text (no escalation) when MAX_ITERATIONS is reached for local-only characters', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: '', functionCalls: [{ name: 'get_current_time', args: {} }] })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response).toEqual({ escalated: false })
    expect(result.current.escalationState).toBe('idle')
    expect(mockGenerateChatReply).toHaveBeenCalledTimes(5)
  })

  it('escalates when generateChatReply throws, for cloud-synced characters', async () => {
    mockGenerateChatReply.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response).toEqual({ escalated: true })
  })

  it('isThinking is true during the call and false after it resolves', async () => {
    let resolveReply: (v: unknown) => void = () => {}
    mockGenerateChatReply.mockReturnValueOnce(new Promise((resolve) => { resolveReply = resolve }))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    expect(result.current.isThinking).toBe(false)

    let done = false
    act(() => {
      void result.current.sendMessage('Hello').then(() => { done = true })
    })

    expect(result.current.isThinking).toBe(true)

    await act(async () => {
      resolveReply({ reply: 'Hi!', functionCalls: undefined })
    })

    expect(result.current.isThinking).toBe(false)
    expect(done).toBe(true)
  })

  it('passes characterId and wiki to createEdgeToolExecutors', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: 'Hi!', functionCalls: undefined })
    const mockWiki = { id: 'wiki-1' } as never

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: mockWiki }),
    )

    await act(async () => {
      await result.current.sendMessage('Hello')
    })

    expect(createEdgeToolExecutors).toHaveBeenCalledWith(character.id, mockWiki)
  })

  it('passes tools from getSchemasForEdge to generateChatReply', async () => {
    mockGenerateChatReply.mockResolvedValue({ reply: 'Hi!', functionCalls: undefined })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateChatReply.mock.calls[0][0]
    const names = (callArgs.tools as { name: string }[]).map((t) => t.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('set_reminder')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- useEdgeAgent`
Expected: FAIL — current `useEdgeAgent()` takes no arguments and always returns `{ escalated: true }`; `createEdgeToolExecutors`/`generateChatReply` are never called.

- [ ] **Step 3: Restore the implementation**

Replace the entire contents of `src/hooks/useEdgeAgent.ts`:

```ts
import { useState, useCallback, useRef, useEffect } from 'react'
import type { IMessage } from 'react-native-gifted-chat'
import { getSchemasForEdge } from '~/services/clankerManifests'
import type { Character } from '~/services/aiChatService'
import type { Wiki } from '~/services/wikiService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'
import { generateChatReply } from '~/services/chatReplyService'

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
  isCloudSynced: boolean
  wiki: Wiki | null
}

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string, memoryBlock?: string) => Promise<{ escalated: boolean; text?: string }>
  isThinking: boolean
  escalationState: EscalationState
}

type ContentPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { output: unknown } } }
type ChatContent = { role: 'user' | 'model'; parts: ContentPart[] }

const MAX_ITERATIONS = 5

export function useEdgeAgent({ character, userId, priorMessages, isCloudSynced, wiki }: UseEdgeAgentOptions): UseEdgeAgentReturn {
  const [isThinking, setIsThinking] = useState(false)
  const [escalationState, setEscalationState] = useState<EscalationState>('idle')
  const priorMessagesRef = useRef(priorMessages)

  useEffect(() => {
    priorMessagesRef.current = priorMessages
  }, [priorMessages])

  const sendMessage = useCallback(
    async (userText: string, memoryBlock?: string): Promise<{ escalated: boolean; text?: string }> => {
      setIsThinking(true)
      setEscalationState('idle')

      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)
      const toolExecutors = createEdgeToolExecutors(character.id, wiki)
      const tools = getSchemasForEdge(!!wiki, isCloudSynced)

      const contents: ChatContent[] = [
        ...historyContents,
        { role: 'user', parts: [{ text: userText }] },
      ]

      try {
        let iterations = 0

        while (iterations < MAX_ITERATIONS) {
          iterations++

          const result = await generateChatReply({
            contents,
            systemInstruction,
            tools,
          })

          const functionCalls = result.functionCalls

          if (!functionCalls || functionCalls.length === 0) {
            return { escalated: false, text: result.reply }
          }

          const responseParts = await Promise.all(
            functionCalls.map(async (fc) => {
              const name = fc.name ?? ''
              const executor = toolExecutors[name]
              const output = executor ? await executor(fc.args ?? {}) : null
              return { functionResponse: { name, response: { output } } }
            }),
          )

          if (responseParts.some((p) => p.functionResponse.response.output === 'ESCALATE_TO_CLOUD_AGENT')) {
            setEscalationState('escalating')
            return { escalated: true }
          }

          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          })

          contents.push({
            role: 'user',
            parts: responseParts,
          })
        }

        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }

        return { escalated: false }
      } catch {
        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }
        return { escalated: false }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId, isCloudSynced, wiki],
  )

  return { sendMessage, isThinking, escalationState }
}
```

Note the `escalate_to_cloud_agent` model-decision path from the old implementation (`functionCalls.some((fc) => fc.name === 'escalate_to_cloud_agent')`) is gone: `escalate_to_cloud_agent` has no executor in `createEdgeToolExecutors`, so `executor` is `undefined` and `output` is `null` for that call — it falls through to a normal `functionResponse` round-trip instead of escalating immediately. Restore that explicit check too, right above the `set_reminder` sentinel check:

```ts
          if (functionCalls.some((fc) => fc.name === 'escalate_to_cloud_agent')) {
            setEscalationState('escalating')
            return { escalated: true }
          }

          const responseParts = await Promise.all(
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- useEdgeAgent`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEdgeAgent.ts src/hooks/__tests__/useEdgeAgent.test.ts
git commit -m "feat(edge): restore useEdgeAgent on top of generateChatReply's multi-turn tool loop"
```

---

## Task 9: Wire `useAIChat.ts`'s call site to the restored `useEdgeAgent` signature

**Files:**
- Modify: `src/hooks/useAIChat.ts:55`

The stub `useEdgeAgent()` took no arguments; the restored hook (Task 8) requires `UseEdgeAgentOptions`. This call site is not mentioned in the spec doc but must be updated or the app fails to compile.

- [ ] **Step 1: Update the call site**

In `src/hooks/useAIChat.ts`, `character`, `userId`, `messages` (the chat history — used elsewhere in this same function as `priorHistory`), `isCloudSynced`, and `wiki` are all already in scope by line 55. Replace:

```ts
  const edgeAgent = useEdgeAgent()
```

with:

```ts
  const edgeAgent = useEdgeAgent({ character, userId, priorMessages: messages, isCloudSynced, wiki })
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors. (`wiki` from `useWiki()` is `WikiMemory`, which is structurally assignable to the `Wiki` type `useEdgeAgent` expects — `WikiMemory` already declares `subscribeEntityStatus`, so no cast is needed.)

- [ ] **Step 3: Run the full app test suite to check for regressions**

Run: `npm test -- useAIChat`
Expected: PASS — `__tests__/useAIChat.test.tsx:100-106` mocks `useEdgeAgent` with `jest.fn(() => ({ sendMessage: ..., escalationState: 'idle' }))`; that factory ignores its arguments already, so it tolerates the new options argument with no changes needed.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAIChat.ts
git commit -m "fix(chat): pass character/userId/history/wiki options to restored useEdgeAgent"
```

---

## Task 10: Silent `emergent` ontology bootstrap in `wikiOrchestrator.getOrSpawn`

**Files:**
- Modify: `src/services/wikiOrchestrator.ts`
- Modify: `__tests__/wikiOrchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `makeWikiMock` factory in `__tests__/wikiOrchestrator.test.ts` (it currently has no ontology methods — add them):

```ts
const makeWikiMock = () => ({
  read: jest.fn().mockResolvedValue(null),
  write: jest.fn().mockResolvedValue(undefined),
  ingestDocument: jest.fn().mockResolvedValue(undefined),
  forget: jest.fn().mockResolvedValue(undefined),
  exportDump: jest.fn().mockResolvedValue({ generatedAt: 0, entities: {} }),
  importDump: jest.fn().mockResolvedValue(undefined),
  runPrune: jest.fn().mockResolvedValue(undefined),
  subscribeEntityStatus: jest.fn(() => () => {}),
  getOntologyManifest: jest.fn().mockResolvedValue(null),
  setOntologyManifest: jest.fn().mockResolvedValue(undefined),
})
```

Add a new `describe` block at the end of the file, before the final closing of the outer `describe('wikiOrchestrator', ...)`:

```ts
  describe('emergent ontology bootstrap', () => {
    it('seeds an empty emergent manifest when no ontology row exists yet', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue(null)
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.getOntologyManifest).toHaveBeenCalledWith('e1')
      expect(wiki.setOntologyManifest).toHaveBeenCalledWith('e1', { node_types: [], edge_types: [] }, { mode: 'emergent' })
    })

    it('seeds when the existing mode is "off"', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue({ mode: 'off', manifest: { node_types: [], edge_types: [] } })
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.setOntologyManifest).toHaveBeenCalledWith('e1', { node_types: [], edge_types: [] }, { mode: 'emergent' })
    })

    it('does not reseed when the existing mode is already emergent', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue({ mode: 'emergent', manifest: { node_types: [], edge_types: [] } })
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
    })

    it('does not reseed when the existing mode is strict', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue({ mode: 'strict', manifest: { node_types: [{ type: 'person', description: 'x' }], edge_types: [] } })
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
    })

    it('only checks once per entity per session: a second getOrSpawn for the same entity does not re-check', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockResolvedValue(null)
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      wiki.getOntologyManifest.mockClear()
      wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(wiki.getOntologyManifest).not.toHaveBeenCalled()
    })

    it('does not throw or block actor creation when getOntologyManifest rejects', async () => {
      const wiki = makeWikiMock()
      wiki.getOntologyManifest.mockRejectedValue(new Error('SQLite locked'))
      const actor = wikiOrchestrator.getOrSpawn('e1', wiki as never)
      await new Promise((r) => setTimeout(r, 0))
      expect(actor).toBeDefined()
      expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- wikiOrchestrator`
Expected: FAIL — `getOntologyManifest`/`setOntologyManifest` are never called by `getOrSpawn` today.

- [ ] **Step 3: Implement the bootstrap**

In `src/services/wikiOrchestrator.ts`, update `getOrSpawn` to fire the bootstrap only on actor creation (not on cache-hit return):

```ts
function getOrSpawn(
  entityId: string,
  wiki: Wiki,
  machineOptions?: WikiOrchestratorMachineOptions,
): WikiActor {
  const existing = actors.get(entityId)
  if (existing) return existing
  const actor = createActor(wikiMachine, {
    input: { entityId, wiki, ...machineOptions },
  })
  actor.start()
  actors.set(entityId, actor)

  void wiki.getOntologyManifest(entityId).then((existing) => {
    if (!existing || existing.mode === 'off') {
      return wiki.setOntologyManifest(entityId, { node_types: [], edge_types: [] }, { mode: 'emergent' })
    }
  }).catch((error) => {
    console.warn(`Failed to bootstrap emergent ontology mode for ${entityId}:`, error)
  })

  return actor
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- wikiOrchestrator`
Expected: PASS (all tests in the file, including the pre-existing ones — the bootstrap is fire-and-forget and does not block `getOrSpawn`'s synchronous return)

- [ ] **Step 5: Commit**

```bash
git add src/services/wikiOrchestrator.ts __tests__/wikiOrchestrator.test.ts
git commit -m "feat(wiki): silently bootstrap emergent ontology mode on first actor spawn per entity"
```

---

## Task 11: `wikiSync.ts` — carry `ontology` through the Postgres sync round-trip

**Files:**
- Modify: `functions/src/wikiSync.ts`
- Modify: `functions/src/wikiSync.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/src/wikiSync.test.ts` (near the other `upsertData`/`fetchMergedDump` injection tests):

```ts
test("wikiSync: ontology bundle round-trips through upsertData/fetchMergedDump unchanged", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const dumpWithOntology = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [],
        tasks: [],
        events: [],
        ontology: { mode: "emergent", manifest: { node_types: [], edge_types: [] } },
      },
    },
  };

  let receivedOntology: unknown;
  const upsertData = async (dump: MemoryDump) => {
    receivedOntology = dump.entities[TEST_ENTITY_UUID]?.ontology;
  };
  const validateEntityOwnership = async () => {};
  const fetchMergedDump = async () => dumpWithOntology;

  const request = { auth, data: { dump: dumpWithOntology } };
  const result = await wikiSyncHandler(request as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    creditService: { spendCredits: async () => "tx-1", refundCredit: async () => {} },
  });

  assert.deepEqual(receivedOntology, { mode: "emergent", manifest: { node_types: [], edge_types: [] } });
  assert.deepEqual(
    result.remoteDump.entities[TEST_ENTITY_UUID]?.ontology,
    { mode: "emergent", manifest: { node_types: [], edge_types: [] } },
  );
});

test("wikiSync: rejects an ontology bundle with an invalid mode", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const dumpWithBadOntology = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [],
        tasks: [],
        events: [],
        ontology: { mode: "not-a-real-mode", manifest: { node_types: [], edge_types: [] } },
      },
    },
  };

  const request = { auth, data: { dump: dumpWithBadOntology } };
  await assert.rejects(
    () =>
      wikiSyncHandler(request as unknown as CallableRequest, {
        validateEntityOwnership: async () => {},
        fetchMergedDump: async () => ({ generatedAt: Date.now(), entities: {} }),
        getUser: async () => user,
        creditService: { spendCredits: async () => "tx-1", refundCredit: async () => {} },
      }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      return true;
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions && npm test`
Expected: FAIL — `MemoryBundle` has no `ontology` field yet (TS compile error) and `parseInput` doesn't validate or pass it through.

- [ ] **Step 3: Implement `MemoryBundle.ontology`, validation, persistence, and read-back**

In `functions/src/wikiSync.ts`, add a local `WikiOntology` interface and extend `MemoryBundle` (right after the existing `WikiEdge` interface, before `MemoryBundle`):

```ts
interface WikiOntology {
  mode: 'strict' | 'emergent' | 'off';
  manifest: {
    node_types: { type: string; description: string }[];
    edge_types: { type: string; source_type: string; target_type: string; description: string }[];
  };
}

interface MemoryBundle {
  facts: WikiFact[];
  tasks: WikiTask[];
  events: WikiEvent[];
  edges?: WikiEdge[];
  ontology?: WikiOntology;
}
```

Add a `validateOntology` function near the other `validateX` functions:

```ts
const VALID_ONTOLOGY_MODE = new Set(["strict", "emergent", "off"]);

function validateOntology(ontology: unknown, label: string): void {
  if (!ontology || typeof ontology !== "object" || Array.isArray(ontology)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  const o = ontology as Record<string, unknown>;
  assertString(o.mode, `${label}.mode`);
  if (!VALID_ONTOLOGY_MODE.has(o.mode as string)) {
    throw new HttpsError("invalid-argument", `${label}.mode must be one of: strict, emergent, off.`);
  }
  if (!o.manifest || typeof o.manifest !== "object" || Array.isArray(o.manifest)) {
    throw new HttpsError("invalid-argument", `${label}.manifest must be an object.`);
  }
  const m = o.manifest as Record<string, unknown>;
  if (!Array.isArray(m.node_types)) {
    throw new HttpsError("invalid-argument", `${label}.manifest.node_types must be an array.`);
  }
  if (!Array.isArray(m.edge_types)) {
    throw new HttpsError("invalid-argument", `${label}.manifest.edge_types must be an array.`);
  }
}
```

In `parseInput`'s per-entity validation loop, after the existing `edges.forEach(...)` line, add:

```ts
    if (b.ontology !== undefined) {
      validateOntology(b.ontology, `Entity "${entityId}".ontology`);
    }
```

Import `llmWikiOntology` (already defined in `functions/src/db/schema.ts`) at the top of `wikiSync.ts`:

```ts
import {llmWikiEntries, llmWikiTasks, llmWikiEvents, llmWikiEdges, llmWikiOntology, characters} from "./db/schema.js";
```

In `upsertWikiData`, after the existing `if (bundle.edges && bundle.edges.length > 0) { ... }` block, add:

```ts
      if (bundle.ontology) {
        await tx
          .insert(llmWikiOntology)
          .values({
            entityId,
            userId,
            mode: bundle.ontology.mode,
            manifest: bundle.ontology.manifest,
            updatedAt: Date.now(),
          })
          .onConflictDoUpdate({
            target: [llmWikiOntology.entityId, llmWikiOntology.userId],
            set: {
              mode: sql`excluded.mode`,
              manifest: sql`excluded.manifest`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
```

In `fetchMergedDump`, add an ontology read query to the `Promise.all` alongside the fact/task/event/edge queries. First add a row type near the other row types:

```ts
  type OntologyRow = {
    entity_id: string;
    mode: string;
    manifest: unknown;
  };
```

Add the query as a 5th element of the `Promise.all` array (after the `edgeResult` query):

```ts
    db.execute<OntologyRow>(sql`
      SELECT entity_id, mode, manifest FROM llm_wiki_ontology
      WHERE entity_id = ANY(${arrayLiteral}) AND user_id = ${userId}::uuid
    `),
```

and destructure it:

```ts
  const [factResult, taskResult, eventResult, edgeResult, ontologyResult] = await Promise.all([
```

Then, after the existing `for (const r of edgeResult.rows) { ... }` loop, add:

```ts
  for (const r of ontologyResult.rows) {
    const entity = entities[r.entity_id];
    if (!entity) continue;
    entity.ontology = {
      mode: r.mode as WikiOntology['mode'],
      manifest: (r.manifest ?? { node_types: [], edge_types: [] }) as WikiOntology['manifest'],
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS (both new tests, plus the full existing suite — `upsertData`/`fetchMergedDump` overrides used by other tests don't touch `ontology` at all, so they're unaffected)

- [ ] **Step 5: Commit**

```bash
git add functions/src/wikiSync.ts functions/src/wikiSync.test.ts
git commit -m "feat(functions): sync ontology mode/manifest through wikiSync to Postgres"
```

---

## Task 12: `useCharacterWiki.ts` — carry ontology through the client-side sync round-trip

**Files:**
- Modify: `src/services/apiClient.ts`
- Modify: `src/hooks/useCharacterWiki.ts`

This is the task most affected by deviation #3 at the top of this plan: `wiki.exportDump()`'s `MemoryDump`/`MemoryBundle` type (from `@equationalapplications/core-llm-wiki`) has no `ontology` field, so `localBundle.ontology` (as the spec literally describes) does not exist. Ontology must be fetched and written back via `wiki.getOntologyManifest`/`setOntologyManifest` directly, and the wire-level request/response types in `apiClient.ts` need a local extension since the package's strict `MemoryDump` type would reject an `ontology` property via TypeScript's excess-property check.

There's no dedicated `wikiOrchestrator`/`useCharacterWiki` unit test exercising `sync()`'s internals end-to-end with a fake remote (the existing tests mock `wiki` at the `wikiOrchestrator` level, one layer below `useCharacterWiki`'s `sync()`). Rather than add a heavyweight new hook-rendering test harness for this single method, this task is verified by a focused unit test of the `runRemoteSync` callback's logic in isolation, plus a manual type-check.

- [ ] **Step 1: Extend the wire types in `apiClient.ts`**

In `src/services/apiClient.ts`, replace:

```ts
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
```

```ts
export interface WikiSyncRequest {
  dump: MemoryDump
}

export interface WikiSyncResponse {
  remoteDump: MemoryDump
}
```

with:

```ts
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

export interface WikiSyncOntology {
  mode: 'strict' | 'emergent' | 'off'
  manifest: {
    node_types: { type: string; description: string }[]
    edge_types: { type: string; source_type: string; target_type: string; description: string }[]
  }
}

// The package's MemoryBundle has no `ontology` field (it lives in a separate table,
// reached only via wiki.getOntologyManifest/setOntologyManifest) — extend the wire
// type locally rather than widening the package's strict MemoryDump type.
export type WikiSyncBundle = MemoryDump['entities'][string] & { ontology?: WikiSyncOntology }
export type WikiSyncDump = Omit<MemoryDump, 'entities'> & { entities: Record<string, WikiSyncBundle> }

export interface WikiSyncRequest {
  dump: WikiSyncDump
}

export interface WikiSyncResponse {
  remoteDump: WikiSyncDump
}
```

- [ ] **Step 2: Update `useCharacterWiki.ts`'s `sync()` to fetch/write ontology directly**

In `src/hooks/useCharacterWiki.ts`, add the new type import alongside the existing one:

```ts
import type { WikiSyncBundle } from '~/services/apiClient'
```

Replace the body of `runRemoteSync` inside `sync()` (the function currently assigned to `runRemoteSync: async (localDump) => { ... }`) with:

```ts
        actor.send({
          type: 'SYNC',
          runRemoteSync: async (localDump) => {
            const localBundle = localDump.entities[entityId] ?? { facts: [], tasks: [], events: [], edges: [] }

            let ontology: WikiSyncBundle['ontology']
            try {
              const existing = await wiki?.getOntologyManifest(entityId)
              if (existing) ontology = existing
            } catch (err) {
              reportError(err, `wiki:${entityId}:ontology:read`)
            }

            const cloudDump = {
              generatedAt: localDump.generatedAt,
              entities: {
                [cloudEntityId]: {
                  facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudEntityId })),
                  tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudEntityId })),
                  events: localBundle.events.map((e) => ({ ...e, entity_id: cloudEntityId })),
                  edges: localBundle.edges?.map((e) => ({ ...e, entity_id: cloudEntityId })) ?? [],
                  ontology,
                } satisfies WikiSyncBundle,
              },
            }
            const result = await wikiSync({ dump: cloudDump })
            const remoteDump = result.data?.remoteDump
            if (!remoteDump) {
              throw new Error('wikiSync returned without remoteDump in response data')
            }
            const cloudBundle = remoteDump.entities[cloudEntityId] ?? { facts: [], tasks: [], events: [], edges: [] }

            if (cloudBundle.ontology && wiki) {
              try {
                await wiki.setOntologyManifest(entityId, cloudBundle.ontology.manifest, { mode: cloudBundle.ontology.mode })
              } catch (err) {
                reportError(err, `wiki:${entityId}:ontology:write`)
              }
            }

            const remappedDump: MemoryDump = {
              generatedAt: remoteDump.generatedAt,
              entities: {
                [entityId]: {
                  facts: cloudBundle.facts,
                  tasks: cloudBundle.tasks,
                  events: cloudBundle.events,
                  edges: cloudBundle.edges?.map((e) => ({ ...e, entity_id: entityId })) ?? [],
                },
              },
            }
            return remappedDump
          },
        })
```

(`remappedDump` deliberately omits `ontology` — it's typed as the package's strict `MemoryDump` because it's handed to the `wikiMachine`'s `importDump`, which doesn't know about ontology at all; the ontology write-back already happened above via `wiki.setOntologyManifest`.)

Also add `wiki` to `sync`'s `useCallback` dependency array (it now reads `wiki` inside the callback):

```ts
  }, [actor, entityId, runSerialized, wiki])
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors in `apiClient.ts` or `useCharacterWiki.ts`.

- [ ] **Step 4: Update `__tests__/useCharacterWiki.test.tsx`'s wiki mocks and add an ontology round-trip test**

`__tests__/useCharacterWiki.test.tsx` already has a `'sync forwards local edges to cloud under the remapped cloud entity id'` test (around line 228) whose `mockWiki = {} as any` has no `getOntologyManifest`/`setOntologyManifest`. Without updating it, `sync()`'s new `wiki?.getOntologyManifest(entityId)` call would throw a `TypeError` that gets silently caught and reported rather than cleanly exercised. Update that test's `mockWiki` and add a new test:

```ts
  test('sync forwards local edges to cloud under the remapped cloud entity id', async () => {
    const mockWiki = {
      getOntologyManifest: jest.fn().mockResolvedValue(null),
      setOntologyManifest: jest.fn().mockResolvedValue(undefined),
    } as any
    mockUseWiki.mockReturnValue(mockWiki)
    const mockActor = createMockActor()
    mockGetOrSpawn.mockReturnValue(mockActor)

    mockWikiSync.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 2000,
          entities: { 'cloud-1': { facts: [], tasks: [], events: [], edges: [] } },
        },
      },
    } as any)

    const { result } = renderHook(() => useCharacterWiki('char1'))
    await act(async () => {
      await result.current.sync('cloud-1')
    })

    const syncArg = mockWikiSync.mock.calls[0][0]
    expect(syncArg.dump.entities['cloud-1'].edges).toEqual([
      { id: 'local-edge', entity_id: 'cloud-1', source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 1 },
    ])
  })

  test('sync sends the local ontology manifest and writes back the cloud-merged one', async () => {
    const mockWiki = {
      getOntologyManifest: jest.fn().mockResolvedValue({ mode: 'emergent', manifest: { node_types: [], edge_types: [] } }),
      setOntologyManifest: jest.fn().mockResolvedValue(undefined),
    } as any
    mockUseWiki.mockReturnValue(mockWiki)
    const mockActor = createMockActor()
    mockGetOrSpawn.mockReturnValue(mockActor)

    mockWikiSync.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 2000,
          entities: {
            'cloud-1': {
              facts: [],
              tasks: [],
              events: [],
              edges: [],
              ontology: { mode: 'emergent', manifest: { node_types: [{ type: 'person', description: 'a person' }], edge_types: [] } },
            },
          },
        },
      },
    } as any)

    const { result } = renderHook(() => useCharacterWiki('char1'))
    await act(async () => {
      await result.current.sync('cloud-1')
    })

    expect(mockWiki.getOntologyManifest).toHaveBeenCalledWith('char1')
    const syncArg = mockWikiSync.mock.calls[0][0]
    expect(syncArg.dump.entities['cloud-1'].ontology).toEqual({ mode: 'emergent', manifest: { node_types: [], edge_types: [] } })

    expect(mockWiki.setOntologyManifest).toHaveBeenCalledWith(
      'char1',
      { node_types: [{ type: 'person', description: 'a person' }], edge_types: [] },
      { mode: 'emergent' },
    )
  })
```

- [ ] **Step 5: Run the test suite**

Run: `npm test -- useCharacterWiki`
Expected: PASS (all tests in the file, including the two above)

- [ ] **Step 6: Commit**

```bash
git add src/services/apiClient.ts src/hooks/useCharacterWiki.ts
git commit -m "feat(wiki): sync ontology manifest through useCharacterWiki via getOntologyManifest/setOntologyManifest"
```

---

## Task 13: `ChatView.tsx` — replace manual wiki status with `useEntityStatus`

**Files:**
- Modify: `src/components/ChatView.tsx`
- Modify: `__tests__/chatViewAccessibility.test.tsx`

- [ ] **Step 1: Update the accessibility test's mock**

In `__tests__/chatViewAccessibility.test.tsx`, replace the `useCharacterWiki` mock:

```ts
let mockWikiStatus = { ingesting: false, librarian: false, heal: false }
jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: () => ({
    status: mockWikiStatus,
    isBusy: false,
    error: null,
    read: jest.fn(),
    write: jest.fn(),
    ingest: jest.fn(),
    forget: jest.fn(),
    sync: jest.fn(),
    hasChanged: jest.fn(),
  }),
}))
```

with:

```ts
let mockWikiStatus = { ingesting: false, librarian: false, heal: false }
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => mockWikiStatus,
}))
```

This is the only place in the file that mocks `~/hooks/useCharacterWiki` or `@equationalapplications/expo-llm-wiki` (verify with `grep -n "useCharacterWiki\|expo-llm-wiki" __tests__/chatViewAccessibility.test.tsx` before editing — there should be exactly one `jest.mock` block for each). The three `mockWikiStatus = {...}` reassignments later in the file (lines ~183, ~256, ~271) need no changes — they still just reassign the same variable the mock factory closes over.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- chatViewAccessibility`
Expected: FAIL — `ChatView.tsx` still imports and calls `useCharacterWiki`, which is no longer mocked (the real hook will be invoked and crash or behave unpredictably under the other mocked modules in this test file).

- [ ] **Step 3: Update `ChatView.tsx`**

In `src/components/ChatView.tsx`, replace the import block:

```ts
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
```

with:

```ts
import { useEntityStatus } from '@equationalapplications/expo-llm-wiki'
```

(Verify first that `ChatView.tsx` has no other call into `useCharacterWiki` — `grep -n "useCharacterWiki" src/components/ChatView.tsx` should return only the import line and the line being changed below; as of this plan it doesn't.)

Replace:

```ts
  const { status: wikiStatus } = useCharacterWiki(characterId)
```

with:

```ts
  const wikiStatus = useEntityStatus(characterId)
```

No other lines in the file change — `wikiStatus.ingesting` (`ChatView.tsx:330`, `:347`) and `wikiStatus.librarian` (`ChatView.tsx:330`, `:350`) keep their existing JSX exactly as-is; `documentPhase` and `escalationState` branches are untouched.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- chatViewAccessibility`
Expected: PASS (all tests, including the "Ingesting document" and "Updating memory" banner assertions, and the `it.each` document-phase banner tests)

- [ ] **Step 5: Type-check and run the full app test suite**

Run: `npx tsc --noEmit && npm test`
Expected: No new TypeScript errors; no new test failures anywhere in the suite (in particular, double-check no other test file mocks `~/hooks/useCharacterWiki` expecting `ChatView` to call it: `grep -rln "useCharacterWiki" __tests__/ src/components/__tests__/ 2>/dev/null`).

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatView.tsx __tests__/chatViewAccessibility.test.tsx
git commit -m "refactor(chat): use useEntityStatus hook instead of manual wikiMachine status in ChatView"
```

---

## Final verification

- [ ] Run the full app suite: `npm test`
- [ ] Run the full functions suite: `cd functions && npm run build && npm test`
- [ ] Type-check both: `npx tsc --noEmit` (root) and `cd functions && npx tsc --noEmit`
- [ ] Manually confirm `shared/agent-tools-spec.ts`'s `agentToolSpec` array has exactly 14 entries (12 original + `wiki_get_ontology` + `wiki_traverse_graph`) and that `functions/src/generateReply.ts`'s `ALLOWED_TOOL_NAMES` Set has the same 12 non-`set_reminder` names (11 `'both'`/`'edge-only'` tools, since `set_reminder` is `'cloud-only'` and excluded — recount against `getSchemasForEdge`'s filter if these drift apart in the future).
- [ ] Confirm no remaining reference to `EXPO_PUBLIC_GEMINI_API_KEY` or `@google/genai` in app code (`grep -rln "EXPO_PUBLIC_GEMINI_API_KEY\|@google/genai" src/ --include="*.ts" --include="*.tsx"` should return nothing outside `src/services/__tests__/edgeAgentEvals.int.test.ts`, which is an out-of-scope manual eval harness, not part of the production loop).
