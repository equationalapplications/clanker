# Phase 4: Edge Task Management & Eval Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add offline task management to the edge agent and establish a dual-layer testing strategy with deterministic unit tests and live LLM routing evals.

**Architecture:** A new SQLite `tasks` table (migration v19) backs `create_task` / `list_tasks` executors. Both tool manifests inject unconditionally into `useEdgeAgent`. LLM evals live in a `*.int.test.ts` file gated behind a manual npm script, never CI.

**Tech Stack:** expo-sqlite (`getDatabase`), `@google/genai` (gemini-2.5-flash, no `generationConfig`), jest

> **Pre-flight:** Sections 2 (JIT Escalation Sync) and 4 (Firebase Ingestion Bridge) from the spec are **already fully implemented** in `useAIChat.ts` and `functions/src/generateReply.ts`. This plan covers only the remaining work: Sections 1 and 3.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/database/schema.ts` | Modify | Add tasks table to `CREATE_TABLES`, bump `SCHEMA_VERSION` to 19, add migration 19 + skip guard |
| `src/database/taskDatabase.ts` | Create | `createTask` / `listTasks` SQLite CRUD |
| `src/services/clankerManifests.ts` | Modify | Add `clankerCreateTaskSchema`, `clankerListTasksSchema`; update escalation description |
| `src/services/edgeToolExecutors.ts` | Modify | Add `create_task` / `list_tasks` executors to factory |
| `src/hooks/useEdgeAgent.ts` | Modify | Inject task schemas unconditionally into `functionDeclarations` |
| `src/services/__tests__/characterPromptBuilder.test.ts` | Modify | Add "Never reveal you are an AI" fourth-wall assertion |
| `src/services/__tests__/clankerManifests.test.ts` | Modify | Tests for task schemas and updated escalation guard |
| `src/services/__tests__/edgeToolExecutors.test.ts` | Modify | Tests for `create_task` / `list_tasks` executors |
| `src/hooks/__tests__/useEdgeAgent.test.ts` | Modify | Add task schemas to manifest mock; add inclusion assertions |
| `src/services/__tests__/edgeAgentEvals.int.test.ts` | Create | Live LLM routing eval tests (manual only) |
| `package.json` | Modify | Add `"edge-evals"` script |

---

## Task 1: Schema migration v19 (tasks table)

**Files:**
- Modify: `src/database/schema.ts`

- [ ] **Step 1: Write the failing schema test**

Create `__tests__/databaseSchema.test.ts` already exists — add to it, or create a new assertion. Instead, for this migration we verify via the executor tests in Task 2. Proceed to implementation directly.

- [ ] **Step 2: Bump SCHEMA_VERSION and add tasks to CREATE_TABLES**

In `src/database/schema.ts`, change `SCHEMA_VERSION` from `18` to `19`:

```typescript
export const SCHEMA_VERSION = 19
```

Add the tasks table block to `CREATE_TABLES` (append before the closing backtick, after the messages indexes):

```sql
  -- Tasks table
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    character_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL
  );

  -- Indexes for tasks
  CREATE INDEX IF NOT EXISTS idx_tasks_character ON tasks(character_id);
```

- [ ] **Step 3: Add migration 19 and its skip guard**

In `MIGRATION_SKIP_GUARDS`, add:

```typescript
19: [{ table: 'tasks', column: 'id' }],
```

In `MIGRATIONS`, add:

```typescript
19: `CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_character ON tasks(character_id)`,
```

- [ ] **Step 4: Run type check**

```bash
npx tsc -p tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/database/schema.ts
git commit -m "feat(db): add tasks table via migration v19"
```

---

## Task 2: taskDatabase.ts — CRUD layer

**Files:**
- Create: `src/database/taskDatabase.ts`
- Test: `__tests__/taskDatabase.test.ts` (new file, runs in CI)

> Note: expo-sqlite is mocked in the jest environment. Pattern: mock `./index` (`getDatabase`) the same way `messageDatabase.ts` tests mock it.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/taskDatabase.test.ts`:

```typescript
import { createTask, listTasks } from '../src/database/taskDatabase'
import { getDatabase } from '../src/database/index'

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(),
}))

const mockDb = {
  runAsync: jest.fn(),
  getAllAsync: jest.fn(),
}

const mockGetDatabase = getDatabase as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockGetDatabase.mockResolvedValue(mockDb)
})

describe('createTask', () => {
  it('inserts a task row and returns an id string', async () => {
    mockDb.runAsync.mockResolvedValue(undefined)
    const id = await createTask('char-1', 'Buy milk')
    expect(typeof id).toBe('string')
    expect(id.startsWith('task_')).toBe(true)
    expect(mockDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      expect.arrayContaining(['char-1', 'Buy milk', 'pending'])
    )
  })

  it('passes the generated id as first bind param', async () => {
    mockDb.runAsync.mockResolvedValue(undefined)
    const id = await createTask('char-1', 'Walk dog')
    const callArgs = mockDb.runAsync.mock.calls[0][1] as string[]
    expect(callArgs[0]).toBe(id)
  })
})

describe('listTasks', () => {
  it('returns rows from the tasks table for the given character', async () => {
    const rows = [
      { id: 'task_1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
    ]
    mockDb.getAllAsync.mockResolvedValue(rows)
    const result = await listTasks('char-1')
    expect(result).toEqual(rows)
    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM tasks WHERE character_id = ?'),
      ['char-1']
    )
  })

  it('returns empty array when no tasks exist', async () => {
    mockDb.getAllAsync.mockResolvedValue([])
    const result = await listTasks('char-1')
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest __tests__/taskDatabase.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '../src/database/taskDatabase'"

- [ ] **Step 3: Implement taskDatabase.ts**

Create `src/database/taskDatabase.ts`:

```typescript
import { getDatabase } from './index'

export interface LocalTask {
  id: string
  character_id: string
  title: string
  status: string
  created_at: number
}

export async function createTask(characterId: string, title: string): Promise<string> {
  const db = await getDatabase()
  const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  await db.runAsync(
    'INSERT INTO tasks (id, character_id, title, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, characterId, title, 'pending', Date.now()],
  )
  return id
}

export async function listTasks(characterId: string): Promise<LocalTask[]> {
  const db = await getDatabase()
  return db.getAllAsync<LocalTask>(
    'SELECT * FROM tasks WHERE character_id = ? ORDER BY created_at DESC',
    [characterId],
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest __tests__/taskDatabase.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/database/taskDatabase.ts __tests__/taskDatabase.test.ts
git commit -m "feat(db): add taskDatabase CRUD for local tasks"
```

---

## Task 3: Task manifests + escalation guard update

**Files:**
- Modify: `src/services/clankerManifests.ts`
- Modify: `src/services/__tests__/clankerManifests.test.ts`

- [ ] **Step 1: Write failing manifest tests**

Append to `src/services/__tests__/clankerManifests.test.ts`:

```typescript
describe('clankerCreateTaskSchema', () => {
  it('has name create_task', () => {
    expect(clankerCreateTaskSchema.name).toBe('create_task')
  })

  it('has required title parameter of type string', () => {
    const params = clankerCreateTaskSchema.parameters as {
      required: string[]
      properties: Record<string, { type: string }>
    }
    expect(params.required).toContain('title')
    expect(params.properties['title'].type).toBe('string')
  })

  it('parameters type is object', () => {
    expect(clankerCreateTaskSchema.parameters.type).toBe('object')
  })
})

describe('clankerListTasksSchema', () => {
  it('has name list_tasks', () => {
    expect(clankerListTasksSchema.name).toBe('list_tasks')
  })

  it('parameters type is object', () => {
    expect(clankerListTasksSchema.parameters.type).toBe('object')
  })
})

describe('clankerEscalationSchema — task guard', () => {
  it('description forbids delegating task creation or listing', () => {
    expect(clankerEscalationSchema.description).toMatch(/task/i)
  })
})
```

Also update the import line at the top of the test file to add the new exports:

```typescript
import {
  clankerTimeSchema,
  clankerEscalationSchema,
  clankerMemorySchema,
  clankerWriteObservationSchema,
  clankerCreateTaskSchema,
  clankerListTasksSchema,
} from '../clankerManifests'
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest src/services/__tests__/clankerManifests.test.ts --no-coverage
```

Expected: FAIL — "clankerCreateTaskSchema is not exported"

- [ ] **Step 3: Add schemas and update escalation description**

Append to `src/services/clankerManifests.ts`:

```typescript
export const clankerCreateTaskSchema = {
  name: 'create_task',
  description:
    'Create a new task or to-do item for the user. Use when the user explicitly asks to add, create, or save a task.',
  parameters: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string' as const,
        description: 'The task description.',
      },
    },
    required: ['title'],
  },
}

export const clankerListTasksSchema = {
  name: 'list_tasks',
  description:
    "List the user's current tasks and to-dos. Use when the user asks what tasks they have or wants to see their list.",
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
}
```

Update `clankerEscalationSchema.description`:

```typescript
export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for checking the time, reading memory, WRITING/saving observations, or creating/listing tasks.',
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest src/services/__tests__/clankerManifests.test.ts --no-coverage
```

Expected: PASS (all suites including the new ones)

- [ ] **Step 5: Commit**

```bash
git add src/services/clankerManifests.ts src/services/__tests__/clankerManifests.test.ts
git commit -m "feat(manifests): add create_task and list_tasks schemas; guard escalation"
```

---

## Task 4: Task executors

**Files:**
- Modify: `src/services/edgeToolExecutors.ts`
- Modify: `src/services/__tests__/edgeToolExecutors.test.ts`

- [ ] **Step 1: Write failing executor tests**

Append to `src/services/__tests__/edgeToolExecutors.test.ts`:

```typescript
import { createTask, listTasks } from '../taskDatabase'
import type { LocalTask } from '../taskDatabase'

jest.mock('../taskDatabase', () => ({
  createTask: jest.fn(),
  listTasks: jest.fn(),
}))

const mockCreateTask = createTask as jest.Mock
const mockListTasks = listTasks as jest.Mock
```

> Note: Place this import block at the top of the file alongside the existing `wikiService` mock. Then append the test suites below the existing ones:

```typescript
describe('createEdgeToolExecutors — create_task', () => {
  beforeEach(() => jest.clearAllMocks())

  it('create_task is present in executor map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['create_task']).toBe('function')
  })

  it('returns failure message when title is missing', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({})
    expect(result).toBe('Failed to create task: title is required.')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('returns failure message when title is empty string', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: '' })
    expect(result).toBe('Failed to create task: title is required.')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('calls createTask with characterId and title', async () => {
    mockCreateTask.mockResolvedValue('task_123')
    const execs = createEdgeToolExecutors('char-42', null)
    await execs['create_task']({ title: 'Buy milk' })
    expect(mockCreateTask).toHaveBeenCalledWith('char-42', 'Buy milk')
  })

  it('returns success message on valid title', async () => {
    mockCreateTask.mockResolvedValue('task_123')
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: 'Buy milk' })
    expect(result).toBe('Task created successfully.')
  })

  it('returns error message when createTask throws', async () => {
    mockCreateTask.mockRejectedValue(new Error('DB locked'))
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['create_task']({ title: 'Buy milk' })
    expect(result).toBe('Failed to create task due to an internal error.')
  })
})

describe('createEdgeToolExecutors — list_tasks', () => {
  beforeEach(() => jest.clearAllMocks())

  it('list_tasks is present in executor map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['list_tasks']).toBe('function')
  })

  it('returns "No tasks found." when list is empty', async () => {
    mockListTasks.mockResolvedValue([])
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    expect(result).toBe('No tasks found.')
  })

  it('returns JSON string with task data when tasks exist', async () => {
    const tasks: LocalTask[] = [
      { id: 'task_1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
    ]
    mockListTasks.mockResolvedValue(tasks)
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    const parsed = JSON.parse(result as string)
    expect(parsed[0].title).toBe('Buy milk')
    expect(parsed[0].status).toBe('pending')
  })

  it('calls listTasks with correct characterId', async () => {
    mockListTasks.mockResolvedValue([])
    const execs = createEdgeToolExecutors('char-42', null)
    await execs['list_tasks']({})
    expect(mockListTasks).toHaveBeenCalledWith('char-42')
  })

  it('returns error message when listTasks throws', async () => {
    mockListTasks.mockRejectedValue(new Error('DB locked'))
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['list_tasks']({})
    expect(result).toBe('Failed to list tasks due to an internal error.')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: FAIL — new test suites reference missing executors.

- [ ] **Step 3: Implement task executors**

In `src/services/edgeToolExecutors.ts`, add the import at the top:

```typescript
import { createTask, listTasks } from '~/database/taskDatabase'
import type { LocalTask } from '~/database/taskDatabase'
```

Inside `createEdgeToolExecutors`, add to the returned object:

```typescript
    create_task: async (args) => {
      try {
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (!title) return 'Failed to create task: title is required.'
        await createTask(characterId, title)
        return 'Task created successfully.'
      } catch (error) {
        console.error('[EdgeAgent] create_task failed:', error)
        return 'Failed to create task due to an internal error.'
      }
    },
    list_tasks: async () => {
      try {
        const tasks = await listTasks(characterId)
        if (tasks.length === 0) return 'No tasks found.'
        return JSON.stringify(
          tasks.map((t: LocalTask) => ({ id: t.id, title: t.title, status: t.status })),
        )
      } catch (error) {
        console.error('[EdgeAgent] list_tasks failed:', error)
        return 'Failed to list tasks due to an internal error.'
      }
    },
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/edgeToolExecutors.ts src/services/__tests__/edgeToolExecutors.test.ts
git commit -m "feat(edge): add create_task and list_tasks tool executors"
```

---

## Task 5: Inject task schemas into useEdgeAgent

**Files:**
- Modify: `src/hooks/useEdgeAgent.ts`
- Modify: `src/hooks/__tests__/useEdgeAgent.test.ts`

- [ ] **Step 1: Write failing injection tests**

In `src/hooks/__tests__/useEdgeAgent.test.ts`, update the `clankerManifests` mock to include the new schemas:

```typescript
jest.mock('~/services/clankerManifests', () => ({
  clankerTimeSchema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  clankerEscalationSchema: { name: 'escalate_to_cloud_agent', description: 'Escalate to cloud', parameters: {} },
  clankerMemorySchema: {
    name: 'search_memory',
    description: 'Search memory',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  clankerWriteObservationSchema: {
    name: 'write_observation',
    description: 'Write observation',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
  clankerCreateTaskSchema: { name: 'create_task', description: 'Create a task', parameters: {} },
  clankerListTasksSchema: { name: 'list_tasks', description: 'List tasks', parameters: {} },
}))
```

Append a new describe block to the test file:

```typescript
  it('always includes create_task and list_tasks regardless of wiki or isCloudSynced', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Hello!', functionCalls: undefined })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('create_task')
    expect(names).toContain('list_tasks')
  })

  it('includes create_task and list_tasks alongside escalation and memory when both enabled', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Hello!', functionCalls: undefined })

    const mockWiki = {} as any
    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: mockWiki }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('create_task')
    expect(names).toContain('list_tasks')
    expect(names).toContain('search_memory')
    expect(names).toContain('escalate_to_cloud_agent')
  })
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest src/hooks/__tests__/useEdgeAgent.test.ts --no-coverage
```

Expected: FAIL — injection tests reference schemas not yet injected.

- [ ] **Step 3: Update useEdgeAgent.ts**

In `src/hooks/useEdgeAgent.ts`, update the import line:

```typescript
import {
  clankerTimeSchema,
  clankerEscalationSchema,
  clankerMemorySchema,
  clankerWriteObservationSchema,
  clankerCreateTaskSchema,
  clankerListTasksSchema,
} from '~/services/clankerManifests'
```

Update the `functionDeclarations` initialization to include task schemas unconditionally:

```typescript
      const functionDeclarations = [clankerTimeSchema, clankerCreateTaskSchema, clankerListTasksSchema]
```

(Replace `const functionDeclarations = [clankerTimeSchema]` — keep the `if (wiki)` and `if (isCloudSynced)` blocks unchanged below it.)

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest src/hooks/__tests__/useEdgeAgent.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full test suite to catch regressions**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useEdgeAgent.ts src/hooks/__tests__/useEdgeAgent.test.ts
git commit -m "feat(edge): inject create_task and list_tasks into edge agent tool declarations"
```

---

## Task 6: CharacterPromptBuilder fourth-wall test

**Files:**
- Modify: `src/services/__tests__/characterPromptBuilder.test.ts`

- [ ] **Step 1: Verify the test is missing**

```bash
npx jest src/services/__tests__/characterPromptBuilder.test.ts --no-coverage --verbose
```

Confirm no test currently asserts "Never reveal you are an AI" or the fourth-wall directive.

- [ ] **Step 2: Add the fourth-wall test**

In `src/services/__tests__/characterPromptBuilder.test.ts`, inside the `describe('buildSystemInstruction', ...)` block, add:

```typescript
  it('includes fourth-wall directive to never reveal AI identity', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).toContain('Never reveal you are an AI')
  })
```

- [ ] **Step 3: Run test — verify it passes**

```bash
npx jest src/services/__tests__/characterPromptBuilder.test.ts --no-coverage
```

Expected: PASS (the directive already exists in `CharacterPromptBuilder.ts:23`)

- [ ] **Step 4: Commit**

```bash
git add src/services/__tests__/characterPromptBuilder.test.ts
git commit -m "test(prompts): assert fourth-wall directive in buildSystemInstruction"
```

---

## Task 7: Add edge-evals npm script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script**

In `package.json`, inside the `"scripts"` object, add after the `"test:watch"` line:

```json
"edge-evals": "jest --testRegex '.*\\.int\\.test\\.ts$' --runInBand",
```

- [ ] **Step 2: Verify it's excluded from normal test runs**

The existing `jest.testMatch` patterns only match `*.test.ts` and `*.spec.ts`. The `edge-evals` script overrides `testRegex` to exclusively match `*.int.test.ts`. Confirm the normal `test` script won't pick up `.int.test.ts` files:

```bash
npx jest --listTests 2>/dev/null | grep "int.test"
```

Expected: no output (no `.int.test.ts` files yet; this verifies exclusion once we add one in Task 8).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add edge-evals script for manual LLM routing evals"
```

---

## Task 8: LLM routing eval tests

**Files:**
- Create: `src/services/__tests__/edgeAgentEvals.int.test.ts`

> These tests hit the real Gemini API. Run them with `npm run edge-evals`. They are never run in CI (`testMatch` in the project jest config does not match `.int.test.ts`). Requires `GOOGLE_GENAI_API_KEY` in env.

- [ ] **Step 1: Create the eval file**

Create `src/services/__tests__/edgeAgentEvals.int.test.ts`:

```typescript
import { GoogleGenAI } from '@google/genai'
import type { Content } from '@google/genai'
import { buildSystemInstruction } from '../CharacterPromptBuilder'
import {
  clankerTimeSchema,
  clankerEscalationSchema,
  clankerMemorySchema,
  clankerWriteObservationSchema,
  clankerCreateTaskSchema,
  clankerListTasksSchema,
} from '../clankerManifests'

const character = {
  id: 'eval-char',
  name: 'Aria',
  appearance: 'warm and curious',
  traits: 'empathetic, helpful',
  emotions: 'gentle',
  context: '',
}

const userId = 'eval-user'

const ALL_TOOLS = [
  {
    functionDeclarations: [
      clankerTimeSchema,
      clankerMemorySchema,
      clankerWriteObservationSchema,
      clankerEscalationSchema,
      clankerCreateTaskSchema,
      clankerListTasksSchema,
    ],
  },
]

async function runEdgeEval(userText: string) {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY is not set')

  const ai = new GoogleGenAI({ apiKey })
  const systemInstruction = buildSystemInstruction({ character, userId })
  const contents: Content[] = [{ role: 'user', parts: [{ text: userText }] }]

  return ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: {
      systemInstruction,
      tools: ALL_TOOLS,
    },
  })
}

describe('Edge Agent LLM Routing Evals', () => {
  it(
    'Test A: asking about a past fact yields a search_memory tool call',
    async () => {
      const result = await runEdgeEval(
        'Do you remember what my favorite food is? You mentioned it before.',
      )
      const calls = result.functionCalls ?? []
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0].name).toBe('search_memory')
    },
    30000,
  )

  it(
    'Test B: asking to write a long essay yields an escalate_to_cloud_agent tool call',
    async () => {
      const result = await runEdgeEval(
        'Write me a detailed 2000-word essay about the history of the Roman Empire, covering economic, military, and cultural factors in its rise and fall.',
      )
      const calls = result.functionCalls ?? []
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0].name).toBe('escalate_to_cloud_agent')
    },
    30000,
  )

  it(
    'Test C: casual chatting yields a text response with no tool calls',
    async () => {
      const result = await runEdgeEval('How are you today?')
      const calls = result.functionCalls ?? []
      expect(calls.length).toBe(0)
      expect(typeof result.text).toBe('string')
      expect((result.text ?? '').length).toBeGreaterThan(0)
    },
    30000,
  )
})
```

- [ ] **Step 2: Verify the file is excluded from normal CI runs**

```bash
npx jest --listTests 2>/dev/null | grep "edgeAgentEvals"
```

Expected: no output.

- [ ] **Step 3: Verify the edge-evals script picks it up**

```bash
npx jest --testRegex '.*\.int\.test\.ts$' --listTests 2>/dev/null
```

Expected: one line showing the path to `edgeAgentEvals.int.test.ts`.

- [ ] **Step 4: (Manual, requires API key) Run the evals**

```bash
GOOGLE_GENAI_API_KEY=<your-key> npm run edge-evals
```

Expected: all 3 tests PASS. If Test B is flaky (model sometimes returns text instead of escalation), tighten the prompt: add "This is too complex for me alone." to the essay request.

- [ ] **Step 5: Commit**

```bash
git add src/services/__tests__/edgeAgentEvals.int.test.ts
git commit -m "test(evals): add LLM routing eval suite for edge agent"
```

---

## Self-Review

### Spec coverage

| Spec section | Covered by |
|---|---|
| 1.1 Deterministic prompt tests (fourth-wall) | Task 6 |
| 1.2 LLM-in-the-loop evals (A, B, C) | Task 8 |
| Package.json `edge-evals` script | Task 7 |
| 2. JIT Escalation Sync | **Already implemented** — `useAIChat.ts:128-150` |
| 3. `clankerCreateTaskSchema` / `clankerListTasksSchema` | Task 3 |
| 3. Escalation description forbids task delegation | Task 3 |
| 3. `create_task` / `list_tasks` executors | Task 4 |
| 3. Injection into `useEdgeAgent` | Task 5 |
| 4. Firebase bulk insert of unsyncedHistory | **Already implemented** — `generateReply.ts:494-532` |

All spec requirements accounted for. No placeholders in code steps.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-01-phase4-edge-tasks-evals.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints

Which approach?
