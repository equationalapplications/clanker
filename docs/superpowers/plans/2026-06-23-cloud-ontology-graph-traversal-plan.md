# Cloud Ontology & Graph Traversal (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `expo-llm-wiki`/`core-llm-tools` to 4.17.0, add Postgres storage for the wiki package's graph edges and per-entity ontology manifest, wire edge sync through `wikiSync.ts`/`useCharacterWiki.ts`/`characterSyncService.ts`, and give `cloud-agent` two new ADK tools (`wiki_get_ontology_manifest`, `wiki_traverse_graph`) backed by a hand-written recursive CTE.

**Architecture:** Two new tables (`llm_wiki_edges`, `llm_wiki_ontology`) mirror the wiki package's SQLite `WikiEdge`/ontology concepts in Cloud SQL. `wikiSync.ts` gains edge validation/persistence/read-back alongside the existing facts/tasks/events handling. Two edge-side call sites that build the sync payload (`useCharacterWiki.ts`, `characterSyncService.ts`) both currently drop `edges` and need the same one-line fix. `cloud-agent` gets a new `graph.ts` helper implementing the traversal as a single recursive CTE (Postgres `text[]` path for cycle guard, confidence-tier `CASE` filter, per-direction `UNION ALL` branches), and a new `ontology.ts` with two zod-typed `FunctionTool`s that call it and format results with the package's `formatGraphContext`.

**Tech Stack:** TypeScript, Drizzle ORM (raw `sql` template + recursive CTE), `@google/adk` `FunctionTool`, zod, `@equationalapplications/core-llm-wiki` (new cloud-agent dependency for `formatGraphContext`/types only), node:test (functions, cloud-agent), Jest (root).

---

## Task 1: Bump package versions

**Files:**
- Modify: `package.json:37-38`
- Modify: `functions/package.json:22`
- Modify: `cloud-agent/package.json:18`

- [ ] **Step 1: Bump root `package.json`**

In `package.json`, change:

```json
    "@equationalapplications/core-llm-tools": "^4.13.1",
    "@equationalapplications/expo-llm-wiki": "4.11.0",
```

to:

```json
    "@equationalapplications/core-llm-tools": "^4.17.0",
    "@equationalapplications/expo-llm-wiki": "4.17.0",
```

- [ ] **Step 2: Bump `functions/package.json`**

In `functions/package.json`, change:

```json
    "@equationalapplications/core-llm-tools": "^4.13.1",
```

to:

```json
    "@equationalapplications/core-llm-tools": "^4.17.0",
```

- [ ] **Step 3: Bump `cloud-agent/package.json` and add `core-llm-wiki`**

In `cloud-agent/package.json`, change:

```json
    "@equationalapplications/core-llm-tools": "^4.13.1",
```

to:

```json
    "@equationalapplications/core-llm-tools": "^4.17.0",
    "@equationalapplications/core-llm-wiki": "^4.17.0",
```

- [ ] **Step 4: Install in all three packages**

Run:
```bash
npm install
cd functions && npm install && cd ..
cd cloud-agent && npm install && cd ..
```
Expected: all three lockfiles update with no errors; `node_modules/@equationalapplications/{expo-llm-wiki,core-llm-tools,core-llm-wiki}` now report version `4.17.0` (`cat node_modules/@equationalapplications/expo-llm-wiki/package.json | grep version`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json functions/package.json functions/package-lock.json cloud-agent/package.json cloud-agent/package-lock.json
git commit -m "chore: bump expo-llm-wiki/core-llm-tools to 4.17.0, add core-llm-wiki to cloud-agent"
```

---

## Task 2: Postgres schema — `llm_wiki_edges` and `llm_wiki_ontology`

**Files:**
- Modify: `functions/src/db/schema.ts:222` (insert after the `llmWikiEvents` block, before the `// Cloud Agent tasks` comment)

- [ ] **Step 1: Add the two tables**

In `functions/src/db/schema.ts`, insert immediately after the closing `}));` of `llmWikiEvents` (line 222) and before the `// Cloud Agent tasks` comment (line 224):

```ts

export const llmWikiEdges = pgTable('llm_wiki_edges', {
  id: text('id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  edgeType: text('edge_type').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityUserIdx: index('llm_wiki_edges_entity_user_idx').on(table.entityId, table.userId),
  sourceIdx: index('llm_wiki_edges_source_idx').on(table.sourceId, table.userId),
  targetIdx: index('llm_wiki_edges_target_idx').on(table.targetId, table.userId),
}));

export const llmWikiOntology = pgTable('llm_wiki_ontology', {
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('off'),
  manifest: jsonb('manifest'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.entityId, table.userId] }),
  modeCheck: check('llm_wiki_ontology_mode_check', sql`${table.mode} IN ('strict', 'emergent', 'off')`),
}));
```

No new imports needed — `pgTable`, `uuid`, `text`, `bigint`, `jsonb`, `index`, `check`, `primaryKey`, `sql` are already imported at the top of the file (lines 1-2).

- [ ] **Step 2: Typecheck**

Run: `cd functions && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/src/db/schema.ts
git commit -m "feat(schema): add llm_wiki_edges and llm_wiki_ontology tables"
```

---

## Task 3: Hand-written migration `0016_llm_wiki_graph.sql`

**Files:**
- Create: `functions/drizzle/0016_llm_wiki_graph.sql`

`_journal.json` stops at `0011_credits_redesign`; `0012`-`0015` are hand-written and not in the journal (per `docs/superpowers/specs/2026-06-20-organization-schema-design.md`). Do **not** run `npx drizzle-kit generate` — it would assign a conflicting number. Do **not** edit `_journal.json` or add snapshot files.

- [ ] **Step 1: Write the migration**

Create `functions/drizzle/0016_llm_wiki_graph.sql` (style matches `functions/drizzle/0015_organizations.sql` — no `--> statement-breakpoint` markers, plain semicolon-terminated statements):

```sql
CREATE TABLE "llm_wiki_edges" (
  "id" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "source_id" text NOT NULL,
  "target_id" text NOT NULL,
  "edge_type" text NOT NULL,
  "created_at" bigint NOT NULL,
  CONSTRAINT "llm_wiki_edges_id_user_id_pk" PRIMARY KEY ("id", "user_id")
);

CREATE TABLE "llm_wiki_ontology" (
  "entity_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "mode" text DEFAULT 'off' NOT NULL,
  "manifest" jsonb,
  "updated_at" bigint NOT NULL,
  CONSTRAINT "llm_wiki_ontology_entity_id_user_id_pk" PRIMARY KEY ("entity_id", "user_id")
);

ALTER TABLE "llm_wiki_edges" ADD CONSTRAINT "llm_wiki_edges_entity_id_characters_id_fk"
  FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_edges" ADD CONSTRAINT "llm_wiki_edges_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_ontology" ADD CONSTRAINT "llm_wiki_ontology_entity_id_characters_id_fk"
  FOREIGN KEY ("entity_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_ontology" ADD CONSTRAINT "llm_wiki_ontology_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "llm_wiki_ontology" ADD CONSTRAINT "llm_wiki_ontology_mode_check"
  CHECK ("mode" IN ('strict', 'emergent', 'off'));

CREATE INDEX "llm_wiki_edges_entity_user_idx" ON "llm_wiki_edges" ("entity_id", "user_id");

CREATE INDEX "llm_wiki_edges_source_idx" ON "llm_wiki_edges" ("source_id", "user_id");

CREATE INDEX "llm_wiki_edges_target_idx" ON "llm_wiki_edges" ("target_id", "user_id");
```

- [ ] **Step 2: Commit**

```bash
git add functions/drizzle/0016_llm_wiki_graph.sql
git commit -m "feat(db): hand-write migration 0016 for llm_wiki_edges/llm_wiki_ontology"
```

(Applying this migration to a live Cloud SQL instance follows the existing "Apply Migrations" steps in `docs/architecture-and-data.md` — not part of this plan; out of scope for local implementation.)

---

## Task 4: `wikiSync.ts` — edge persistence

**Files:**
- Modify: `functions/src/wikiSync.ts`
- Test: `functions/src/wikiSync.test.ts`

- [ ] **Step 1: Write failing tests for edge validation**

Append to `functions/src/wikiSync.test.ts` (after the last test, before EOF):

```ts
test("wikiSync: rejects malformed edge (missing required field)", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [],
        tasks: [],
        events: [],
        edges: [{ id: "e1", entity_id: TEST_ENTITY_UUID /* missing source_id, target_id, edge_type, created_at */ }],
      },
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      creditService: defaultCreditService,
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /edges\[0\]\.source_id must be a non-empty string/);
      return true;
    }
  );
});

test("wikiSync: rejects edge with mismatched entity_id", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {
        facts: [],
        tasks: [],
        events: [],
        edges: [{
          id: "e1",
          entity_id: "00000000-0000-0000-0000-000000000099",
          source_id: "fact-1",
          target_id: "fact-2",
          edge_type: "relates_to",
          created_at: 1000,
        }],
      },
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      creditService: defaultCreditService,
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /edges\[0\]\.entity_id must match the entity key/);
      return true;
    }
  );
});

test("wikiSync: rejects too many edges per entity", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  const tooManyEdges = Array.from({length: 501}, (_, i) => ({
    id: `edge-${i}`,
    entity_id: TEST_ENTITY_UUID,
    source_id: "fact-1",
    target_id: "fact-2",
    edge_type: "relates_to",
    created_at: 1000,
  }));
  const badDump = {
    generatedAt: Date.now(),
    entities: {
      [TEST_ENTITY_UUID]: {facts: [], tasks: [], events: [], edges: tooManyEdges},
    },
  };
  const request = {auth, data: {dump: badDump}};
  await assert.rejects(
    () => wikiSyncHandler(request as unknown as CallableRequest, {
      getUser: async () => user,
      creditService: defaultCreditService,
    }),
    (err: HttpsError) => {
      assert.equal(err.code, "invalid-argument");
      assert.match(err.message, /more than 500 edges/);
      return true;
    }
  );
});

test("wikiSync: accepts valid dump with edges and forwards them to upsertData", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);

  let capturedDump: MemoryDump | null = null;
  const upsertData = async (dump: MemoryDump) => {
    capturedDump = dump;
  };
  const validateEntityOwnership = async () => { /* ownership validated by test setup */ };
  const fetchMergedDump = async () => ({generatedAt: Date.now(), entities: {}});

  const dump = buildDump() as MemoryDump;
  (dump.entities[TEST_ENTITY_UUID] as unknown as Record<string, unknown>).edges = [{
    id: "edge-1",
    entity_id: TEST_ENTITY_UUID,
    source_id: "fact-1",
    target_id: "fact-2",
    edge_type: "relates_to",
    created_at: 1000000,
  }];

  await wikiSyncHandler({auth, data: {dump}} as unknown as CallableRequest, {
    upsertData,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    creditService: defaultCreditService,
  });

  assert.equal(capturedDump!.entities[TEST_ENTITY_UUID].edges?.length, 1);
  assert.equal(capturedDump!.entities[TEST_ENTITY_UUID].edges?.[0].id, "edge-1");
});

test("wikiSync: accepts dump without edges field (backward compatible)", async () => {
  const auth = buildAuth();
  const user = buildUser(auth);
  const upserted: unknown[] = [];
  const upsertEntries = async (entries: unknown[]) => { upserted.push(...entries); };
  const validateEntityOwnership = async () => {};
  const fetchMergedDump = async () => ({generatedAt: Date.now(), entities: {}});

  await wikiSyncHandler({auth, data: {dump: buildDump()}} as unknown as CallableRequest, {
    upsertEntries,
    validateEntityOwnership,
    fetchMergedDump,
    getUser: async () => user,
    creditService: defaultCreditService,
  });
  assert.equal(upserted.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && node --test --test-reporter spec lib/wikiSync.test.js`
Expected: the five new tests FAIL (edges field doesn't exist yet on `MemoryBundle`/isn't validated).

- [ ] **Step 3: Add the `WikiEdge` interface, extend `MemoryBundle`, add `validateEdge`**

In `functions/src/wikiSync.ts`, change the import on line 9:

```ts
import {llmWikiEntries, llmWikiTasks, llmWikiEvents, characters} from "./db/schema.js";
```

to:

```ts
import {llmWikiEntries, llmWikiTasks, llmWikiEvents, llmWikiEdges, characters} from "./db/schema.js";
```

Add a `WikiEdge` interface after `WikiEvent` (after line 48) and extend `MemoryBundle` (lines 50-54):

```ts
interface WikiEdge {
  id: string;
  entity_id: string;
  source_id: string;
  target_id: string;
  edge_type: string;
  created_at: number;
}

interface MemoryBundle {
  facts: WikiFact[];
  tasks: WikiTask[];
  events: WikiEvent[];
  edges?: WikiEdge[];
}
```

Add `MAX_EDGES_PER_ENTITY` next to the other `MAX_*` constants (after line 75):

```ts
const MAX_EDGES_PER_ENTITY = 500;
```

Add `validateEdge` after `validateEvent` (after line 204):

```ts
function validateEdge(edge: unknown, entityId: string, label: string): void {
  if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
    throw new HttpsError("invalid-argument", `${label} must be an object.`);
  }
  const e = edge as Record<string, unknown>;
  assertString(e.id, `${label}.id`);
  if (e.entity_id !== entityId) {
    throw new HttpsError(
      "invalid-argument",
      `${label}.entity_id must match the entity key "${entityId}".`
    );
  }
  assertString(e.source_id, `${label}.source_id`);
  assertString(e.target_id, `${label}.target_id`);
  assertString(e.edge_type, `${label}.edge_type`);
  assertNumber(e.created_at, `${label}.created_at`);
}
```

- [ ] **Step 4: Validate edges in `parseInput`**

In `parseInput`, change the array-type checks block (lines 242-250):

```ts
    if (!Array.isArray(b.facts)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".facts must be an array.`);
    }
    if (!Array.isArray(b.tasks)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".tasks must be an array.`);
    }
    if (!Array.isArray(b.events)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".events must be an array.`);
    }
```

to:

```ts
    if (!Array.isArray(b.facts)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".facts must be an array.`);
    }
    if (!Array.isArray(b.tasks)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".tasks must be an array.`);
    }
    if (!Array.isArray(b.events)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".events must be an array.`);
    }
    if (b.edges !== undefined && !Array.isArray(b.edges)) {
      throw new HttpsError("invalid-argument", `Entity "${entityId}".edges must be an array.`);
    }
    const edges = (b.edges as unknown[] | undefined) ?? [];
```

Then change the cap-check block (lines 252-269) to add an edges cap, and the per-item validation block (lines 271-273) to add edge validation:

```ts
    if (b.facts.length > MAX_FACTS_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_FACTS_PER_ENTITY} facts.`
      );
    }
    if (b.tasks.length > MAX_TASKS_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_TASKS_PER_ENTITY} tasks.`
      );
    }
    if (b.events.length > MAX_EVENTS_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_EVENTS_PER_ENTITY} events.`
      );
    }
    if (edges.length > MAX_EDGES_PER_ENTITY) {
      throw new HttpsError(
        "invalid-argument",
        `Entity "${entityId}" may not contain more than ${MAX_EDGES_PER_ENTITY} edges.`
      );
    }

    b.facts.forEach((f: unknown, i: number) => validateFact(f, entityId, `Entity "${entityId}".facts[${i}]`));
    b.tasks.forEach((t: unknown, i: number) => validateTask(t, entityId, `Entity "${entityId}".tasks[${i}]`));
    b.events.forEach((e: unknown, i: number) => validateEvent(e, entityId, `Entity "${entityId}".events[${i}]`));
    edges.forEach((e: unknown, i: number) => validateEdge(e, entityId, `Entity "${entityId}".edges[${i}]`));
```

- [ ] **Step 5: Persist edges in `upsertWikiData`**

In `upsertWikiData`, after the `events` insert block (after line 528, the closing `.onConflictDoNothing();` for events, before the closing `}` of the `for` loop on line 529), add:

```ts

      if (bundle.edges && bundle.edges.length > 0) {
        await tx
          .insert(llmWikiEdges)
          .values(
            bundle.edges.map((e) => ({
              id: e.id,
              entityId,
              userId,
              sourceId: e.source_id,
              targetId: e.target_id,
              edgeType: e.edge_type,
              createdAt: e.created_at,
            }))
          )
          .onConflictDoNothing();
      }
```

- [ ] **Step 6: Read edges back in `fetchMergedDump`**

Add an `EdgeRow` type after `EventRow` (after line 325):

```ts
  type EdgeRow = {
    id: string;
    entity_id: string;
    source_id: string;
    target_id: string;
    edge_type: string;
    created_at: string;
  };
```

Add a fourth query to the `Promise.all` (lines 337-378), changing:

```ts
  const [factResult, taskResult, eventResult] = await Promise.all([
```

to:

```ts
  const [factResult, taskResult, eventResult, edgeResult] = await Promise.all([
```

and adding a fourth query inside the array, after the `eventResult` query (after its closing `),` before the array's closing `]);`):

```ts
    db.execute<EdgeRow>(sql`
      WITH ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY entity_id
            ORDER BY created_at DESC
          ) AS rn
        FROM llm_wiki_edges
        WHERE entity_id = ANY(${arrayLiteral})
          AND user_id = ${userId}::uuid
      )
      SELECT * FROM ranked WHERE rn <= ${MAX_EDGES_PER_ENTITY}
    `),
```

Change the `entities` initialization (line 382):

```ts
    entities[entityId] = {facts: [], tasks: [], events: []};
```

to:

```ts
    entities[entityId] = {facts: [], tasks: [], events: [], edges: []};
```

Add an edge-mapping loop after the events loop (after line 432, before the closing `}` of `fetchMergedDump` on line 434... i.e. after the `for (const r of eventResult.rows) { ... }` block):

```ts

  for (const r of edgeResult.rows) {
    const entity = entities[r.entity_id];
    if (!entity) continue;
    entity.edges!.push({
      id: r.id,
      entity_id: r.entity_id,
      source_id: r.source_id,
      target_id: r.target_id,
      edge_type: r.edge_type,
      created_at: Number(r.created_at),
    });
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd functions && npm run build && node --test --test-reporter spec lib/wikiSync.test.js`
Expected: all tests PASS, including the five new ones.

- [ ] **Step 8: Run the full functions test suite**

Run: `cd functions && npm test`
Expected: all tests PASS (no regressions in the other 90+ wikiSync tests or unrelated suites).

- [ ] **Step 9: Commit**

```bash
git add functions/src/wikiSync.ts functions/src/wikiSync.test.ts
git commit -m "feat(wikiSync): validate, persist, and read back graph edges"
```

---

## Task 5: `useCharacterWiki.ts` — forward edges through manual sync

**Files:**
- Modify: `src/hooks/useCharacterWiki.ts:183-205`
- Test: `__tests__/useCharacterWiki.test.tsx`

- [ ] **Step 1: Extend the shared mock actor to support `SYNC`**

In `__tests__/useCharacterWiki.test.tsx`, inside `createMockActor`'s `send` mock implementation (the object passed to `.mockImplementation`, after the existing `if (event.type === 'READ') { ... }` block, still inside the same `send: jest.fn().mockImplementation((event) => { ... })`), add:

```ts
        if (event.type === 'SYNC') {
          state = 'syncing'
          callback?.(snapshot(state))
          Promise.resolve()
            .then(() => event.runRemoteSync({
              generatedAt: 1000,
              entities: {
                char1: {
                  facts: [],
                  tasks: [],
                  events: [],
                  edges: [{ id: 'local-edge', entity_id: 'char1', source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 1 }],
                },
              },
            }))
            .then(() => {
              state = 'idle'
              callback?.(snapshot(state))
            })
        }
```

- [ ] **Step 2: Write the failing test**

Add to `__tests__/useCharacterWiki.test.tsx`, after the `read returns lastReadResult from context` test:

```ts
  test('sync forwards local edges to cloud under the remapped cloud entity id', async () => {
    const mockWiki = {} as any
    mockUseWiki.mockReturnValue(mockWiki)
    const mockActor = createMockActor()
    mockGetOrSpawn.mockReturnValue(mockActor)

    const { wikiSync } = await import('~/services/apiClient')
    ;(wikiSync as jest.Mock).mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 2000,
          entities: { 'cloud-1': { facts: [], tasks: [], events: [], edges: [] } },
        },
      },
    })

    const { result } = renderHook(() => useCharacterWiki('char1'))
    await act(async () => {
      await result.current.sync('cloud-1')
    })

    const syncArg = (wikiSync as jest.Mock).mock.calls[0][0]
    expect(syncArg.dump.entities['cloud-1'].edges).toEqual([
      { id: 'local-edge', entity_id: 'cloud-1', source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 1 },
    ])
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- useCharacterWiki.test.tsx`
Expected: FAIL — `syncArg.dump.entities['cloud-1'].edges` is `undefined` (current `sync()` drops `edges`).

- [ ] **Step 4: Fix `sync()` in `useCharacterWiki.ts`**

In `src/hooks/useCharacterWiki.ts`, change (lines 183-205):

```ts
            const localBundle = localDump.entities[entityId] ?? { facts: [], tasks: [], events: [] }
            const cloudDump: MemoryDump = {
              generatedAt: localDump.generatedAt,
              entities: {
                [cloudEntityId]: {
                  facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudEntityId })),
                  tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudEntityId })),
                  events: localBundle.events.map((e) => ({ ...e, entity_id: cloudEntityId })),
                },
              },
            }
            const result = await wikiSync({ dump: cloudDump })
            const remoteDump = result.data?.remoteDump
            if (!remoteDump) {
              throw new Error('wikiSync returned without remoteDump in response data')
            }
            const remappedDump: MemoryDump = {
              generatedAt: remoteDump.generatedAt,
              entities: {
                [entityId]: remoteDump.entities[cloudEntityId] ?? { facts: [], tasks: [], events: [] },
              },
            }
            return remappedDump
```

to:

```ts
            const localBundle = localDump.entities[entityId] ?? { facts: [], tasks: [], events: [], edges: [] }
            const cloudDump: MemoryDump = {
              generatedAt: localDump.generatedAt,
              entities: {
                [cloudEntityId]: {
                  facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudEntityId })),
                  tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudEntityId })),
                  events: localBundle.events.map((e) => ({ ...e, entity_id: cloudEntityId })),
                  edges: localBundle.edges?.map((e) => ({ ...e, entity_id: cloudEntityId })) ?? [],
                },
              },
            }
            const result = await wikiSync({ dump: cloudDump })
            const remoteDump = result.data?.remoteDump
            if (!remoteDump) {
              throw new Error('wikiSync returned without remoteDump in response data')
            }
            const cloudBundle = remoteDump.entities[cloudEntityId] ?? { facts: [], tasks: [], events: [], edges: [] }
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- useCharacterWiki.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCharacterWiki.ts __tests__/useCharacterWiki.test.tsx
git commit -m "fix(wiki): forward edges through useCharacterWiki sync()"
```

---

## Task 6: `characterSyncService.ts` — forward edges through batched sync

**Files:**
- Modify: `src/services/characterSyncService.ts:114-137`
- Test: `__tests__/characterSyncWiki.test.ts`

This is the actual production sync path used by `syncAllToCloud` (invoked via `wikiOrchestrator.syncAll`). It has the identical bug, independently of Task 5's hook-level fix.

- [ ] **Step 1: Write the failing test**

In `__tests__/characterSyncWiki.test.ts`, add a new test immediately after `'remaps local->cloud and cloud->local within runRemoteSync callback'` (after line 164):

```ts
  it('propagates edges through runRemoteSync in both directions', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    await syncAllToCloud('user-1')

    const [itemsArg] = mockSyncAll.mock.calls[0]
    const runRemoteSync = itemsArg[0].runRemoteSync as (dump: any) => Promise<any>
    mockWikiSyncFn.mockResolvedValue({
      data: {
        remoteDump: {
          generatedAt: 1001,
          entities: {
            [CLOUD_ID]: {
              facts: [], tasks: [], events: [],
              edges: [{ id: 're1', entity_id: CLOUD_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 5 }],
            },
          },
        },
      },
    })

    const remapped = await runRemoteSync({
      generatedAt: 1000,
      entities: {
        [LOCAL_ID]: {
          facts: [], tasks: [], events: [],
          edges: [{ id: 'le1', entity_id: LOCAL_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 4 }],
        },
      },
    })

    const syncArg = mockWikiSyncFn.mock.calls[mockWikiSyncFn.mock.calls.length - 1][0]
    expect(syncArg.dump.entities[CLOUD_ID].edges).toEqual([
      { id: 'le1', entity_id: CLOUD_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 4 },
    ])
    expect(remapped.entities[LOCAL_ID].edges).toEqual([
      { id: 're1', entity_id: LOCAL_ID, source_id: 'a', target_id: 'b', edge_type: 'knows', created_at: 5 },
    ])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- characterSyncWiki.test.ts`
Expected: FAIL — `syncArg.dump.entities[CLOUD_ID].edges` is `undefined`.

- [ ] **Step 3: Fix `runRemoteSync` in `characterSyncService.ts`**

In `src/services/characterSyncService.ts`, change (lines 114-137):

```ts
            runRemoteSync: async (localDump: MemoryDump): Promise<MemoryDump> => {
                const localBundle = localDump.entities[char.id] ?? { facts: [], tasks: [], events: [] }
                const cloudDump: MemoryDump = {
                    generatedAt: localDump.generatedAt,
                    entities: {
                        [cloudId]: {
                            facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudId })),
                            tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudId })),
                            events: localBundle.events.map((e) => ({ ...e, entity_id: cloudId })),
                        },
                    },
                }
                const result = await wikiSync({ dump: cloudDump })
                const remoteDump = result.data?.remoteDump
                if (!remoteDump) {
                    throw new Error('wikiSync returned without remoteDump in response data')
                }
                return {
                    generatedAt: remoteDump.generatedAt,
                    entities: {
                        [char.id]: remoteDump.entities[cloudId] ?? { facts: [], tasks: [], events: [] },
                    },
                }
            },
```

to:

```ts
            runRemoteSync: async (localDump: MemoryDump): Promise<MemoryDump> => {
                const localBundle = localDump.entities[char.id] ?? { facts: [], tasks: [], events: [], edges: [] }
                const cloudDump: MemoryDump = {
                    generatedAt: localDump.generatedAt,
                    entities: {
                        [cloudId]: {
                            facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudId })),
                            tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudId })),
                            events: localBundle.events.map((e) => ({ ...e, entity_id: cloudId })),
                            edges: localBundle.edges?.map((e) => ({ ...e, entity_id: cloudId })) ?? [],
                        },
                    },
                }
                const result = await wikiSync({ dump: cloudDump })
                const remoteDump = result.data?.remoteDump
                if (!remoteDump) {
                    throw new Error('wikiSync returned without remoteDump in response data')
                }
                const cloudBundle = remoteDump.entities[cloudId] ?? { facts: [], tasks: [], events: [], edges: [] }
                return {
                    generatedAt: remoteDump.generatedAt,
                    entities: {
                        [char.id]: {
                            facts: cloudBundle.facts,
                            tasks: cloudBundle.tasks,
                            events: cloudBundle.events,
                            edges: cloudBundle.edges?.map((e) => ({ ...e, entity_id: char.id })) ?? [],
                        },
                    },
                }
            },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- characterSyncWiki.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Run the full root test suite**

Run: `npm test`
Expected: all tests PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/services/characterSyncService.ts __tests__/characterSyncWiki.test.ts
git commit -m "fix(wiki): forward edges through characterSyncService batched sync"
```

---

## Task 7: Mirror `llm_wiki_edges`/`llm_wiki_ontology` into `cloud-agent`'s schema

**Files:**
- Modify: `cloud-agent/src/db/schema.ts` (append after the `llmWikiEntries` block, end of file)

`cloud-agent/src/db/schema.ts` is a hand-maintained minimal mirror of `functions/src/db/schema.ts` (per its header comment) — the cloud-agent tools in Task 9 need these two tables available through its own `DrizzleClient`.

- [ ] **Step 1: Add the two tables**

Append to the end of `cloud-agent/src/db/schema.ts` (after the closing `}))` of `llmWikiEntries`, line 83), matching this file's no-semicolon style:

```ts

export const llmWikiEdges = pgTable('llm_wiki_edges', {
  id: text('id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  edgeType: text('edge_type').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityUserIdx: index('llm_wiki_edges_entity_user_idx').on(table.entityId, table.userId),
  sourceIdx: index('llm_wiki_edges_source_idx').on(table.sourceId, table.userId),
  targetIdx: index('llm_wiki_edges_target_idx').on(table.targetId, table.userId),
}))

export const llmWikiOntology = pgTable('llm_wiki_ontology', {
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('off'),
  manifest: jsonb('manifest'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.entityId, table.userId] }),
  modeCheck: check('llm_wiki_ontology_mode_check', sql`${table.mode} IN ('strict', 'emergent', 'off')`),
}))
```

No new imports needed — `pgTable`, `uuid`, `text`, `bigint`, `jsonb`, `index`, `check`, `primaryKey`, `sql` are already imported (lines 4-8).

- [ ] **Step 2: Typecheck**

Run: `cd cloud-agent && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/db/schema.ts
git commit -m "feat(cloud-agent): mirror llm_wiki_edges/llm_wiki_ontology into schema"
```

---

## Task 8: `cloud-agent/src/tools/graph.ts` — `traverseGraphCte` helper

**Files:**
- Create: `cloud-agent/src/tools/graph.ts`
- Test: `cloud-agent/src/tools/graph.test.ts`

This implements the recursive CTE described in the spec: anchor row not gated by confidence, recursive step joins `llm_wiki_edges` per `direction` (`UNION ALL` branch per allowed direction), `text[]` path column for the cycle guard, confidence-tier `CASE` filter on discovered nodes only, dedupe via `DISTINCT ON (id)` ordered by `depth ASC` (keeps the minimum depth per node — equivalent to `GROUP BY node_id` + `MIN(depth)`), final order `depth ASC, updated_at DESC`, capped by `maxTraversalNodes`. Edges returned are every `llm_wiki_edges` row whose `source_id` and `target_id` are both in the final node set (matches the verified SQLite `EdgeRepository.getNeighborhood` semantics in the published `core-llm-wiki` package).

- [ ] **Step 1: Write the failing tests**

Create `cloud-agent/src/tools/graph.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type Row = Record<string, unknown>

function makeMockDb(executeResults: Row[][]) {
  let call = 0
  const calls: unknown[] = []
  return {
    execute: async (query: unknown) => {
      calls.push(query)
      const rows = executeResults[call] ?? []
      call += 1
      return { rows }
    },
    _calls: calls,
  } as unknown as DrizzleClient & { _calls: unknown[] }
}

const { traverseGraphCte } = await import('./graph.js')

test('traverseGraphCte: returns anchor only when edgeTypes is an explicit empty array', async () => {
  const anchorRow = {
    id: 'fact-1', title: 'T', body: 'B', tags: [], confidence: 'inferred', source_type: 'agent_inferred',
    source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
    created_at: '100', updated_at: '200', deleted_at: null,
  }
  const db = makeMockDb([[anchorRow]])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'fact-1', edgeTypes: [] })
  assert.equal(result.nodes.length, 1)
  assert.equal(result.nodes[0].id, 'fact-1')
  assert.equal(result.edges.length, 0)
  assert.equal((db as unknown as { _calls: unknown[] })._calls.length, 1)
})

test('traverseGraphCte: returns empty neighborhood when anchor not found (edgeTypes empty)', async () => {
  const db = makeMockDb([[]])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'missing', edgeTypes: [] })
  assert.deepEqual(result, { nodes: [], edges: [] })
})

test('traverseGraphCte: returns empty neighborhood when anchor not found (default traversal)', async () => {
  const db = makeMockDb([[]])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'missing' })
  assert.deepEqual(result, { nodes: [], edges: [] })
  assert.equal((db as unknown as { _calls: unknown[] })._calls.length, 1)
})

test('traverseGraphCte: maps node rows to WikiFact shape and fetches edges among found node ids', async () => {
  const nodeRows = [
    {
      id: 'fact-1', title: 'Anchor', body: 'B1', tags: ['a'], confidence: 'certain', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: '500', access_count: 3,
      created_at: '100', updated_at: '300', deleted_at: null, depth: 0,
    },
    {
      id: 'fact-2', title: 'Neighbor', body: 'B2', tags: [], confidence: 'inferred', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
      created_at: '150', updated_at: '350', deleted_at: null, depth: 1,
    },
  ]
  const edgeRows = [
    { id: 'edge-1', source_id: 'fact-1', target_id: 'fact-2', edge_type: 'relates_to', created_at: '120' },
  ]
  const db = makeMockDb([nodeRows, edgeRows])
  const result = await traverseGraphCte(db, 'user-1', 'entity-1', { sourceId: 'fact-1', maxDepth: 2 })

  assert.equal(result.nodes.length, 2)
  assert.equal(result.nodes[0].id, 'fact-1')
  assert.equal(result.nodes[0].created_at, 100)
  assert.equal(result.nodes[0].updated_at, 300)
  assert.equal(result.nodes[0].last_accessed_at, 500)
  assert.equal(result.nodes[1].id, 'fact-2')
  assert.equal(result.edges.length, 1)
  assert.equal(result.edges[0].id, 'edge-1')
  assert.equal(result.edges[0].entity_id, 'entity-1')
  assert.equal(result.edges[0].source_id, 'fact-1')
  assert.equal(result.edges[0].target_id, 'fact-2')
  assert.equal((db as unknown as { _calls: unknown[] })._calls.length, 2)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cloud-agent && npm run build && node --test --test-reporter spec dist/tools/graph.test.js`
Expected: FAIL with a module-not-found error for `./graph.js` (file doesn't exist yet).

- [ ] **Step 3: Implement `traverseGraphCte`**

Create `cloud-agent/src/tools/graph.ts`:

```ts
import { sql } from 'drizzle-orm'
import type { GraphNeighborhood, WikiEdge, WikiFact } from '@equationalapplications/core-llm-wiki'
import type { DrizzleClient } from '../db/client.js'

export interface TraverseGraphOptions {
  sourceId: string
  maxDepth?: number
  direction?: 'inbound' | 'outbound' | 'both'
  edgeTypes?: string[]
  maxTraversalNodes?: number
  minTraversalConfidence?: 'certain' | 'inferred' | 'tentative'
}

interface EntryRow {
  id: string
  title: string
  body: string
  tags: unknown
  confidence: string
  source_type: string
  source_ref: string | null
  source_hash: string | null
  last_accessed_at: string | null
  access_count: number | string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface EdgeRow {
  id: string
  source_id: string
  target_id: string
  edge_type: string
  created_at: string
}

const CONFIDENCE_RANK: Record<'tentative' | 'inferred' | 'certain', number> = {
  tentative: 0,
  inferred: 1,
  certain: 2,
}

function mapEntryRowToFact(row: EntryRow, entityId: string): WikiFact {
  return {
    id: row.id,
    entity_id: entityId,
    title: row.title,
    body: row.body,
    tags: (row.tags ?? []) as string[],
    confidence: row.confidence,
    source_type: row.source_type,
    source_ref: row.source_ref,
    source_hash: row.source_hash,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    last_accessed_at: row.last_accessed_at != null ? Number(row.last_accessed_at) : null,
    access_count: row.access_count != null ? Number(row.access_count) : 0,
    deleted_at: row.deleted_at != null ? Number(row.deleted_at) : null,
  } as unknown as WikiFact
}

export async function traverseGraphCte(
  db: DrizzleClient,
  userId: string,
  entityId: string,
  options: TraverseGraphOptions,
): Promise<GraphNeighborhood> {
  const direction = options.direction ?? 'both'
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 1, 1), 3)
  const maxTraversalNodes = options.maxTraversalNodes ?? 20
  const minConfidenceRank = CONFIDENCE_RANK[options.minTraversalConfidence ?? 'tentative']
  const edgeTypes = options.edgeTypes

  // Explicit empty array means "match no edge types" — anchor only, matching
  // GraphTraversalOptions.edgeTypes semantics (distinct from undefined = no filter).
  if (edgeTypes && edgeTypes.length === 0) {
    const anchorResult = await db.execute<EntryRow>(sql`
      SELECT id, title, body, tags, confidence, source_type, source_ref, source_hash,
             last_accessed_at, access_count, created_at, updated_at, deleted_at
      FROM llm_wiki_entries
      WHERE id = ${options.sourceId} AND entity_id = ${entityId}::uuid AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
    `)
    if (anchorResult.rows.length === 0) return { nodes: [], edges: [] }
    return { nodes: [mapEntryRowToFact(anchorResult.rows[0], entityId)], edges: [] }
  }

  const edgeTypeFilter = edgeTypes && edgeTypes.length > 0
    ? sql`AND e.edge_type IN (${sql.join(edgeTypes.map((t) => sql`${t}`), sql`, `)})`
    : sql``

  const outboundBranch = direction !== 'inbound'
    ? sql`
      UNION ALL
      SELECT next.id, next.title, next.body, next.tags, next.confidence, next.source_type, next.source_ref,
             next.source_hash, next.last_accessed_at, next.access_count, next.created_at, next.updated_at,
             next.deleted_at, t.depth + 1 AS depth, t.path || next.id AS path
      FROM traversal t
      JOIN llm_wiki_edges e ON e.entity_id = ${entityId}::uuid AND e.user_id = ${userId}::uuid AND e.source_id = t.id
      JOIN llm_wiki_entries next ON next.id = e.target_id AND next.entity_id = ${entityId}::uuid
        AND next.user_id = ${userId}::uuid AND next.deleted_at IS NULL
      WHERE t.depth < ${maxDepth}
        AND NOT (next.id = ANY(t.path))
        AND (CASE next.confidence WHEN 'certain' THEN 2 WHEN 'inferred' THEN 1 ELSE 0 END) >= ${minConfidenceRank}
        ${edgeTypeFilter}
    `
    : sql``

  const inboundBranch = direction !== 'outbound'
    ? sql`
      UNION ALL
      SELECT next.id, next.title, next.body, next.tags, next.confidence, next.source_type, next.source_ref,
             next.source_hash, next.last_accessed_at, next.access_count, next.created_at, next.updated_at,
             next.deleted_at, t.depth + 1 AS depth, t.path || next.id AS path
      FROM traversal t
      JOIN llm_wiki_edges e ON e.entity_id = ${entityId}::uuid AND e.user_id = ${userId}::uuid AND e.target_id = t.id
      JOIN llm_wiki_entries next ON next.id = e.source_id AND next.entity_id = ${entityId}::uuid
        AND next.user_id = ${userId}::uuid AND next.deleted_at IS NULL
      WHERE t.depth < ${maxDepth}
        AND NOT (next.id = ANY(t.path))
        AND (CASE next.confidence WHEN 'certain' THEN 2 WHEN 'inferred' THEN 1 ELSE 0 END) >= ${minConfidenceRank}
        ${edgeTypeFilter}
    `
    : sql``

  const nodeResult = await db.execute<EntryRow & { depth: number }>(sql`
    WITH RECURSIVE traversal AS (
      SELECT id, title, body, tags, confidence, source_type, source_ref, source_hash,
             last_accessed_at, access_count, created_at, updated_at, deleted_at,
             0 AS depth, ARRAY[id] AS path
      FROM llm_wiki_entries
      WHERE id = ${options.sourceId} AND entity_id = ${entityId}::uuid AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
      ${outboundBranch}
      ${inboundBranch}
    )
    SELECT id, title, body, tags, confidence, source_type, source_ref, source_hash,
           last_accessed_at, access_count, created_at, updated_at, deleted_at, depth
    FROM (
      SELECT DISTINCT ON (id) id, title, body, tags, confidence, source_type, source_ref, source_hash,
             last_accessed_at, access_count, created_at, updated_at, deleted_at, depth
      FROM traversal
      ORDER BY id, depth ASC
    ) deduped
    ORDER BY depth ASC, updated_at DESC
    LIMIT ${maxTraversalNodes}
  `)

  if (nodeResult.rows.length === 0) return { nodes: [], edges: [] }

  const nodes = nodeResult.rows.map((row) => mapEntryRowToFact(row, entityId))
  const nodeIds = nodes.map((n) => n.id)

  const edgeResult = await db.execute<EdgeRow>(sql`
    SELECT id, source_id, target_id, edge_type, created_at
    FROM llm_wiki_edges
    WHERE entity_id = ${entityId}::uuid AND user_id = ${userId}::uuid
      AND source_id IN (${sql.join(nodeIds.map((id) => sql`${id}`), sql`, `)})
      AND target_id IN (${sql.join(nodeIds.map((id) => sql`${id}`), sql`, `)})
  `)

  const edges: WikiEdge[] = edgeResult.rows.map((r) => ({
    id: r.id,
    entity_id: entityId,
    source_id: r.source_id,
    target_id: r.target_id,
    edge_type: r.edge_type,
    created_at: Number(r.created_at),
  }))

  return { nodes, edges }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cloud-agent && npm run build && node --test --test-reporter spec dist/tools/graph.test.js`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/graph.ts cloud-agent/src/tools/graph.test.ts
git commit -m "feat(cloud-agent): add traverseGraphCte recursive-CTE graph helper"
```

---

## Task 9: `cloud-agent/src/tools/ontology.ts` — ADK tools

**Files:**
- Create: `cloud-agent/src/tools/ontology.ts`
- Test: `cloud-agent/src/tools/ontology.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `cloud-agent/src/tools/ontology.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

type Row = Record<string, unknown>

function makeMockSelectDb(selectRows: Row[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectRows,
        }),
      }),
    }),
  } as unknown as DrizzleClient
}

function makeMockExecuteDb(executeResults: Row[][]) {
  let call = 0
  return {
    execute: async (_query: unknown) => {
      const rows = executeResults[call] ?? []
      call += 1
      return { rows }
    },
  } as unknown as DrizzleClient
}

const { wikiGetOntologyManifestTool, wikiTraverseGraphTool } = await import('./ontology.js')

test('wikiGetOntologyManifestTool: name is wiki_get_ontology_manifest', () => {
  const db = makeMockSelectDb([])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_get_ontology_manifest')
})

test('wikiGetOntologyManifestTool: schema has no parameters', () => {
  const db = makeMockSelectDb([])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  assert.deepEqual(decl.parameters?.properties ?? {}, {})
})

test('wikiGetOntologyManifestTool: returns off/null when no row exists', async () => {
  const db = makeMockSelectDb([])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.deepEqual(JSON.parse(result), { mode: 'off', manifest: null })
})

test('wikiGetOntologyManifestTool: returns stored mode and manifest when a row exists', async () => {
  const manifest = { node_types: [{ type: 'person', description: 'A person' }], edge_types: [] }
  const db = makeMockSelectDb([{ mode: 'emergent', manifest }])
  const tool = wikiGetOntologyManifestTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: () => Promise<string> }).execute()
  assert.deepEqual(JSON.parse(result), { mode: 'emergent', manifest })
})

test('wikiTraverseGraphTool: name is wiki_traverse_graph', () => {
  const db = makeMockExecuteDb([])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  assert.equal(tool.name, 'wiki_traverse_graph')
})

test('wikiTraverseGraphTool: schema does not expose entityId or userId', () => {
  const db = makeMockExecuteDb([])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const decl = tool._getDeclaration()
  const props = decl.parameters?.properties ?? {}
  assert.ok(!('entityId' in props))
  assert.ok(!('userId' in props))
  assert.ok('sourceId' in props)
})

test('wikiTraverseGraphTool: returns failure string when sourceId is missing', async () => {
  const db = makeMockExecuteDb([])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ sourceId: '' })
  assert.equal(result, 'Failed to traverse graph: sourceId is required.')
})

test('wikiTraverseGraphTool: returns "No graph data found" when traversal is empty', async () => {
  const db = makeMockExecuteDb([[]])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ sourceId: 'missing' })
  assert.equal(result, 'No graph data found for that node.')
})

test('wikiTraverseGraphTool: formats a found neighborhood via formatGraphContext', async () => {
  const nodeRows = [
    {
      id: 'fact-1', title: 'Anchor', body: 'B1', tags: [], confidence: 'certain', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
      created_at: '100', updated_at: '300', deleted_at: null, depth: 0,
    },
    {
      id: 'fact-2', title: 'Neighbor', body: 'B2', tags: [], confidence: 'inferred', source_type: 'agent_inferred',
      source_ref: null, source_hash: null, last_accessed_at: null, access_count: 0,
      created_at: '150', updated_at: '350', deleted_at: null, depth: 1,
    },
  ]
  const edgeRows = [
    { id: 'edge-1', source_id: 'fact-1', target_id: 'fact-2', edge_type: 'knows', created_at: '120' },
  ]
  const db = makeMockExecuteDb([nodeRows, edgeRows])
  const tool = wikiTraverseGraphTool(db, 'user-1', 'char-1')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({ sourceId: 'fact-1' })
  assert.ok(result.includes('Anchor'))
  assert.ok(result.includes('Neighbor'))
  assert.ok(result.includes('knows'))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd cloud-agent && npm run build && node --test --test-reporter spec dist/tools/ontology.test.js`
Expected: FAIL with a module-not-found error for `./ontology.js`.

- [ ] **Step 3: Implement `ontology.ts`**

Create `cloud-agent/src/tools/ontology.ts`:

```ts
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { formatGraphContext } from '@equationalapplications/core-llm-wiki'
import { llmWikiOntology } from '../db/schema.js'
import { traverseGraphCte } from './graph.js'
import type { DrizzleClient } from '../db/client.js'

export function wikiGetOntologyManifestTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_get_ontology_manifest',
    description: "Retrieve the current ontology manifest (allowed node types and edge types) for the user's memory. Use this to understand the structure of the knowledge graph and what relationships exist before traversing it.",
    parameters: z.object({}),
    execute: async (): Promise<string> => {
      try {
        const rows = await db
          .select({ mode: llmWikiOntology.mode, manifest: llmWikiOntology.manifest })
          .from(llmWikiOntology)
          .where(and(eq(llmWikiOntology.entityId, characterId), eq(llmWikiOntology.userId, userId)))
          .limit(1)
        const row = rows[0]
        return JSON.stringify(row ?? { mode: 'off', manifest: null })
      } catch (error) {
        console.error('[CloudAgent] wiki_get_ontology_manifest failed:', error)
        return 'Failed to retrieve ontology manifest due to an internal error.'
      }
    },
  })
}

export function wikiTraverseGraphTool(db: DrizzleClient, userId: string, characterId: string): FunctionTool {
  return new FunctionTool({
    name: 'wiki_traverse_graph',
    description: 'Traverse the knowledge graph starting from a specific fact ID to discover connected concepts and relationships. Returns a formatted neighborhood subgraph.',
    parameters: z.object({
      sourceId: z.string().describe('The exact ID of the starting fact node (obtained from a previous wiki_read call).'),
      maxDepth: z.number().int().min(1).max(3).optional().describe('How many relationship hops to traverse. Maximum allowed is 3. Default 1.'),
      direction: z.enum(['inbound', 'outbound', 'both']).optional().describe("The direction of relationships to follow. Default 'both'."),
      edgeTypes: z.array(z.string()).optional().describe('Optional filter. If provided, traversal only follows these edge types (e.g. ["reports_to", "depends_on"]).'),
      maxTraversalNodes: z.number().int().min(1).optional().describe('Maximum number of nodes to return, including the anchor. Default 20.'),
      minTraversalConfidence: z.enum(['certain', 'inferred', 'tentative']).optional().describe('Minimum confidence tier required for discovered nodes. Does not gate the anchor. Default tentative.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      try {
        const { sourceId, maxDepth, direction, edgeTypes, maxTraversalNodes, minTraversalConfidence } = args as {
          sourceId: string
          maxDepth?: number
          direction?: 'inbound' | 'outbound' | 'both'
          edgeTypes?: string[]
          maxTraversalNodes?: number
          minTraversalConfidence?: 'certain' | 'inferred' | 'tentative'
        }
        if (!sourceId?.trim()) return 'Failed to traverse graph: sourceId is required.'

        const neighborhood = await traverseGraphCte(db, userId, characterId, {
          sourceId: sourceId.trim(),
          maxDepth,
          direction,
          edgeTypes,
          maxTraversalNodes,
          minTraversalConfidence,
        })

        if (neighborhood.nodes.length === 0) return 'No graph data found for that node.'
        return formatGraphContext(neighborhood)
      } catch (error) {
        console.error('[CloudAgent] wiki_traverse_graph failed:', error)
        return 'Failed to traverse graph due to an internal error.'
      }
    },
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd cloud-agent && npm run build && node --test --test-reporter spec dist/tools/ontology.test.js`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/ontology.ts cloud-agent/src/tools/ontology.test.ts
git commit -m "feat(cloud-agent): add wiki_get_ontology_manifest and wiki_traverse_graph tools"
```

---

## Task 10: Wire the new tools into `agent.ts`

**Files:**
- Modify: `cloud-agent/src/agent.ts`
- Modify: `cloud-agent/src/agent.test.ts`

- [ ] **Step 1: Update the failing test expectations**

In `cloud-agent/src/agent.test.ts`, change line 11-14:

```ts
test('buildAgent: returns LlmAgent with 11 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.tools.length, 11)
})
```

to:

```ts
test('buildAgent: returns LlmAgent with 13 tools', () => {
  const agent = buildAgent(mockDb, 'user-1', 'char-1', 'You are Alice.', timezone, mockEmbed)
  assert.equal(agent.tools.length, 13)
})
```

and add two assertions to the `registers all required tool names` test (after line 29, `assert.ok(names.includes('google_search'), 'missing google_search')`):

```ts
  assert.ok(names.includes('wiki_get_ontology_manifest'), 'missing wiki_get_ontology_manifest')
  assert.ok(names.includes('wiki_traverse_graph'), 'missing wiki_traverse_graph')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloud-agent && npm run build && node --test --test-reporter spec dist/agent.test.js`
Expected: FAIL — `agent.tools.length` is 11, not 13; names don't include the new tools.

- [ ] **Step 3: Wire the tools into `buildAgent`**

In `cloud-agent/src/agent.ts`, change the import block (lines 1-7):

```ts
import { LlmAgent, GOOGLE_SEARCH } from '@google/adk'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import { getCurrentTimeTool } from './tools/time.js'
import { documentSearchTool } from './tools/documents.js'
import { setReminderTool } from './tools/reminders.js'
import type { DrizzleClient } from './db/client.js'
```

to:

```ts
import { LlmAgent, GOOGLE_SEARCH } from '@google/adk'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/tasks.js'
import { wikiReadTool, wikiWriteTool } from './tools/wiki.js'
import { wikiGetOntologyManifestTool, wikiTraverseGraphTool } from './tools/ontology.js'
import { getCurrentTimeTool } from './tools/time.js'
import { documentSearchTool } from './tools/documents.js'
import { setReminderTool } from './tools/reminders.js'
import type { DrizzleClient } from './db/client.js'
```

and the `tools` array (lines 20-32):

```ts
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
```

to:

```ts
    tools: [
      getCurrentTimeTool(timezone),
      wikiReadTool(db, userId, characterId, embed),
      wikiWriteTool(db, userId, characterId, embed),
      wikiGetOntologyManifestTool(db, userId, characterId),
      wikiTraverseGraphTool(db, userId, characterId),
      createTaskTool(db, userId, characterId),
      listTasksTool(db, userId, characterId),
      updateTaskTool(db, userId, characterId),
      completeTaskTool(db, userId, characterId),
      deleteTaskTool(db, userId, characterId),
      documentSearchTool(db, userId, characterId),
      setReminderTool(db, userId, characterId),
      GOOGLE_SEARCH,
    ],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloud-agent && npm run build && node --test --test-reporter spec dist/agent.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Run the full cloud-agent test suite**

Run: `cd cloud-agent && npm test`
Expected: all tests PASS (no regressions in `agent.live.test.ts`'s skip-when-no-live-creds path or other suites).

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/agent.ts cloud-agent/src/agent.test.ts
git commit -m "feat(cloud-agent): register wiki_get_ontology_manifest and wiki_traverse_graph on the agent"
```

---

## Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck all three packages**

```bash
npm run typecheck
cd functions && npm run typecheck && cd ..
cd cloud-agent && npm run typecheck && cd ..
```
Expected: no errors in any package.

- [ ] **Step 2: Run all three test suites**

```bash
npm test
cd functions && npm test && cd ..
cd cloud-agent && npm test && cd ..
```
Expected: all PASS.

- [ ] **Step 3: Confirm migration file is self-consistent with schema.ts**

Run: `grep -c "CREATE TABLE" functions/drizzle/0016_llm_wiki_graph.sql`
Expected: `2` (matches the two new tables added to `functions/src/db/schema.ts` in Task 2).

- [ ] **Step 4: Confirm `_journal.json` was not touched**

Run: `git diff --stat functions/drizzle/meta/_journal.json`
Expected: empty output (no changes).
