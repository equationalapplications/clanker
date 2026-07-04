# OKF Import Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users restore an OKF backup into an existing character (merge or replace) and clone a new character from an OKF bundle, mirroring the shipped export feature's patterns.

**Architecture:** A three-utility pipeline (`okfImport.ts` picks/reads/sanitizes the zip, `okfImportRemap.ts` regenerates fact/task ids for cloning, `okfImportDedupe.ts` filters already-seen events before a restore) feeds a single hook (`useImportCharacterOKF`) that both UI entry points — restore in the character edit screen, clone in the character list screen — call identically.

**Tech Stack:** Expo/React Native, `expo-document-picker`, `jszip`, `expo-file-system` (`File` class), `expo-crypto` (`randomUUID`), `@equationalapplications/expo-llm-wiki` (`parseOkfBundle`, `WikiBusyError`, `useWiki`), Jest + `@testing-library/react-native`. All dependencies already installed — no `package.json` changes.

---

## Before You Start

Read `docs/superpowers/specs/2026-07-04-okf-import-support-design.md` in full — it verifies every package internal this plan relies on (`importDump`/`parseOkfBundle` behavior, `WikiBusyError`, the cross-entity collision guard, the events-dedup gap) against the actual installed `node_modules/@equationalapplications/core-llm-wiki` source, not docs. This plan implements that spec; it does not re-derive it.

Two corrections this plan makes to the spec's own pseudocode (found during verification while writing this plan — see Task 4 and Task 6 notes):

1. The spec's hook sketch imports `type OkfFile` from `@equationalapplications/expo-llm-wiki`. That type is not re-exported (confirmed: `core-llm-wiki/dist/index.d.ts` imports `OkfFile` from `@equationalapplications/core-okf` internally but only re-exports `parseOkfBundle`/`formatOkfBundle`, which reference it structurally, not the type itself). `OkfFile` is defined locally in `okfImport.ts` instead, exactly like the export feature already does for its own copy.
2. The spec's clone-flow description says the new character's name should be "derived from the bundle's `index.md`". Verified against `core-okf/dist/index.mjs`'s `buildRootIndexMd`/`buildIndexMd`: neither function writes a human-readable character name anywhere in the bundle — only entity ids and section headers. There is nothing reliable to extract. The new character is created with the same generic default name pattern the "New" button already uses (`'New Character'` at `app/(drawer)/(tabs)/characters/list.tsx:33`), here `'Imported Character'` — the user renames it from the edit screen afterward, same as any newly created character today.

---

## Task 1: Pick, Read, and Sanitize the OKF Zip (`src/utilities/okfImport.ts`)

**Files:**
- Create: `src/utilities/okfImport.ts`
- Test: `src/utilities/__tests__/okfImport.test.ts`

This is the only place untrusted zip bytes are handled. Everything downstream (`parseOkfBundle`) assumes it already received a small, well-shaped file list.

- [ ] **Step 1: Write the failing test file**

```typescript
// src/utilities/__tests__/okfImport.test.ts
import {
  pickAndReadOkfBundle,
  OkfPickCancelledError,
  MAX_OKF_ZIP_RAW_BYTES,
  MAX_OKF_TOTAL_UNCOMPRESSED_BYTES,
} from '../okfImport'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import JSZip from 'jszip'

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}))

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}))

jest.mock('jszip', () => ({
  __esModule: true,
  default: { loadAsync: jest.fn() },
}))

const mockGetDocumentAsync = jest.mocked(DocumentPicker.getDocumentAsync)
const MockFile = jest.mocked(File)
const mockLoadAsync = jest.mocked(JSZip.loadAsync)

function mockZipEntry(content: string, declaredSize?: number) {
  return {
    dir: false,
    async: jest.fn().mockResolvedValue(content),
    _data: declaredSize !== undefined ? { uncompressedSize: declaredSize } : undefined,
  }
}

function setupPicker(size = 1000) {
  mockGetDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://bundle.zip', size, name: 'bundle.zip' }],
  } as any)
  MockFile.mockImplementation(
    () =>
      ({
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      }) as any,
  )
}

describe('pickAndReadOkfBundle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('throws OkfPickCancelledError when the picker is cancelled', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true } as any)
    await expect(pickAndReadOkfBundle()).rejects.toBeInstanceOf(OkfPickCancelledError)
  })

  it('rejects before reading when the raw file size exceeds the cap', async () => {
    setupPicker(MAX_OKF_ZIP_RAW_BYTES + 1)
    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
    expect(mockLoadAsync).not.toHaveBeenCalled()
  })

  it('rejects a crafted entry with a huge declared uncompressedSize without decompressing it', async () => {
    setupPicker()
    const bombEntry = mockZipEntry('x', MAX_OKF_TOTAL_UNCOMPRESSED_BYTES + 1)
    mockLoadAsync.mockResolvedValue({
      files: { 'entities/char_1/facts/fact_a.md': bombEntry },
    } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
    expect(bombEntry.async).not.toHaveBeenCalled()
  })

  it('catches a bundle whose actual decompressed content exceeds the cap even with no declared size', async () => {
    setupPicker()
    const hugeContent = 'x'.repeat(1000)
    mockLoadAsync.mockResolvedValue({
      files: { 'entities/char_1/facts/fact_a.md': mockZipEntry(hugeContent) },
    } as any)

    // Simulate a cap far smaller than the real constant so the test runs fast;
    // done by asserting the running-total code path directly via a bundle
    // that exceeds MAX_OKF_TOTAL_UNCOMPRESSED_BYTES using repeated entries
    // instead of one giant string (avoids allocating 100MB in the test).
    const manyEntries: Record<string, ReturnType<typeof mockZipEntry>> = {}
    const chunk = 'x'.repeat(1_000_000)
    const entriesNeeded = Math.ceil(MAX_OKF_TOTAL_UNCOMPRESSED_BYTES / chunk.length) + 1
    for (let i = 0; i < entriesNeeded; i++) {
      manyEntries[`entities/char_1/facts/fact_${i}.md`] = mockZipEntry(chunk)
    }
    mockLoadAsync.mockResolvedValue({ files: manyEntries } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
  })

  it('keeps only exact allow-listed OKF paths and drops a bundle-root README.md', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: {
        'index.md': mockZipEntry('# root'),
        'README.md': mockZipEntry('# readme junk'),
        'entities/char_1/index.md': mockZipEntry('# entity index'),
        'entities/char_1/log.md': mockZipEntry('# log'),
        'entities/char_1/facts/fact_a.md': mockZipEntry('---\nid: fact_a\n---\nBody'),
        'entities/char_1/tasks/task_a.md': mockZipEntry('---\nid: task_a\n---\n'),
      },
    } as any)

    const files = await pickAndReadOkfBundle()
    const paths = files.map((f) => f.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'index.md',
        'entities/char_1/index.md',
        'entities/char_1/log.md',
        'entities/char_1/facts/fact_a.md',
        'entities/char_1/tasks/task_a.md',
      ]),
    )
    expect(paths).not.toContain('README.md')
  })

  it('rejects a bundle containing more than one entities/{id}/ directory', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: {
        'entities/char_1/facts/fact_a.md': mockZipEntry('---\nid: fact_a\n---\n'),
        'entities/char_2/facts/fact_b.md': mockZipEntry('---\nid: fact_b\n---\n'),
      },
    } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow(/multiple characters/)
  })

  it('rejects a bundle where no concept files survive filtering', async () => {
    setupPicker()
    mockLoadAsync.mockResolvedValue({
      files: { 'README.md': mockZipEntry('# junk only') },
    } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow("doesn't look like a valid OKF backup")
  })

  it('rejects a zip with more entries than the entry-count cap', async () => {
    setupPicker()
    const files: Record<string, ReturnType<typeof mockZipEntry>> = {}
    for (let i = 0; i < 5001; i++) {
      files[`entities/char_1/facts/fact_${i}.md`] = mockZipEntry('x')
    }
    mockLoadAsync.mockResolvedValue({ files } as any)

    await expect(pickAndReadOkfBundle()).rejects.toThrow('Bundle too large or malformed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utilities/__tests__/okfImport.test.ts`
Expected: FAIL — `Cannot find module '../okfImport'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/utilities/okfImport.ts
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import JSZip from 'jszip'

export interface OkfFile {
  path: string
  content: string
}

export class OkfPickCancelledError extends Error {
  constructor() {
    super('Import cancelled')
    this.name = 'OkfPickCancelledError'
  }
}

// Raw zip file size, checked before any decompression — mirrors the
// MAX_DOCUMENT_RAW_BYTES precedent at src/components/documentMimeTypes.ts:4,
// but larger: an OKF bundle is a zip archive of many small markdown files,
// not a single plain-text document.
export const MAX_OKF_ZIP_RAW_BYTES = 50_000_000

// A real OKF bundle is one file per fact/task plus a handful of index/log
// files. 5,000 comfortably covers any real character while rejecting a
// crafted zip with hundreds of thousands of empty entries.
export const MAX_OKF_ZIP_ENTRIES = 5_000

// Total decompressed content cap across all allow-listed entries — the real
// zip-bomb defense. Generous for any real character export (a few MB of
// markdown at most), tight enough to reject a crafted bomb.
export const MAX_OKF_TOTAL_UNCOMPRESSED_BYTES = 100_000_000

const OKF_PATH_PATTERN =
  /^(index\.md|entities\/[^/]+\/(index\.md|log\.md|facts\/[^/]+\.md|tasks\/[^/]+\.md))$/

function isAllowedOkfPath(path: string): boolean {
  return OKF_PATH_PATTERN.test(path)
}

function extractEntityId(path: string): string | null {
  const match = path.match(/^entities\/([^/]+)\//)
  return match ? match[1] : null
}

export async function pickAndReadOkfBundle(): Promise<OkfFile[]> {
  const pickerResult = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/zip', 'application/x-zip-compressed'],
  })
  if (pickerResult.canceled || !pickerResult.assets?.[0]) {
    throw new OkfPickCancelledError()
  }

  const asset = pickerResult.assets[0]
  if (typeof asset.size === 'number' && asset.size > MAX_OKF_ZIP_RAW_BYTES) {
    throw new Error('Bundle too large or malformed')
  }

  const pickedFile = new File(asset.uri)
  const arrayBuffer = await pickedFile.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir)
  if (entries.length > MAX_OKF_ZIP_ENTRIES) {
    throw new Error('Bundle too large or malformed')
  }

  // Fast pre-filter using JSZip's parsed central-directory metadata. This is
  // attacker-controlled header data — a crafted zip can lie about it — so it
  // only avoids decompression work for the obviously-oversized case. The
  // running actual-content-length check below is the real defense.
  let declaredTotal = 0
  for (const [path, entry] of entries) {
    if (!isAllowedOkfPath(path)) continue
    const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize
    if (typeof declaredSize === 'number') {
      declaredTotal += declaredSize
      if (declaredTotal > MAX_OKF_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('Bundle too large or malformed')
      }
    }
  }

  const files: OkfFile[] = []
  const entityIds = new Set<string>()
  let actualTotal = 0

  for (const [path, entry] of entries) {
    if (!isAllowedOkfPath(path)) continue

    const content = await entry.async('string')
    actualTotal += content.length
    if (actualTotal > MAX_OKF_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('Bundle too large or malformed')
    }

    const entityId = extractEntityId(path)
    if (entityId) entityIds.add(entityId)
    files.push({ path, content })
  }

  if (entityIds.size > 1) {
    throw new Error(
      "This bundle contains multiple characters — multi-character import isn't supported yet.",
    )
  }

  if (files.length === 0) {
    throw new Error("This doesn't look like a valid OKF backup.")
  }

  return files
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utilities/__tests__/okfImport.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utilities/okfImport.ts src/utilities/__tests__/okfImport.test.ts
git commit -m "feat(okf): add zip pick/read/sanitize pipeline for OKF import"
```

---

## Task 2: ID Remapping for Cloning (`src/utilities/okfImportRemap.ts`)

**Files:**
- Create: `src/utilities/okfImportRemap.ts`
- Test: `src/utilities/__tests__/okfImportRemap.test.ts`

Regenerates fact/task ids so a cloned character's rows don't collide with the source character's still-existing rows under `importDump`'s cross-entity collision guard (see spec, "Cross-entity ID collision is actively guarded"). Event ids are never touched here — `parseOkfBundle` already regenerates every event id on each parse, so there's no old event id to remap in the first place.

- [ ] **Step 1: Write the failing test file**

```typescript
// src/utilities/__tests__/okfImportRemap.test.ts
import { remapOkfDumpIds } from '../okfImportRemap'
import { randomUUID } from 'expo-crypto'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}))

const mockRandomUUID = jest.mocked(randomUUID)

function buildDump(): MemoryDump {
  return {
    generatedAt: 1783094400000,
    entities: {
      char_new: {
        facts: [
          { id: 'fact_1', entity_id: 'char_new' } as any,
          { id: 'fact_2', entity_id: 'char_new' } as any,
        ],
        tasks: [{ id: 'task_1', entity_id: 'char_new' } as any],
        events: [
          { id: 'evt_1', entity_id: 'char_new', related_entry_id: 'fact_1' } as any,
          { id: 'evt_2', entity_id: 'char_new', related_entry_id: null } as any,
        ],
        edges: [
          {
            id: 'edge_1',
            entity_id: 'char_new',
            source_id: 'fact_1',
            target_id: 'fact_2',
            edge_type: 'related_to',
          } as any,
          {
            id: 'edge_2',
            entity_id: 'char_new',
            source_id: 'fact_1',
            target_id: 'nonexistent',
            edge_type: 'related_to',
          } as any,
        ],
      },
    },
  }
}

describe('remapOkfDumpIds', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    let counter = 0
    mockRandomUUID.mockImplementation(() => `new-${++counter}` as ReturnType<typeof randomUUID>)
  })

  it('assigns new ids to every fact and task, old ids fully absent', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new

    const factIds = entity.facts.map((f) => f.id)
    const taskIds = entity.tasks.map((t) => t.id)

    expect(factIds).not.toContain('fact_1')
    expect(factIds).not.toContain('fact_2')
    expect(taskIds).not.toContain('task_1')
    expect(new Set([...factIds, ...taskIds]).size).toBe(3)
  })

  it('rewrites edge source_id/target_id through the id map', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new
    const [newFact1, newFact2] = entity.facts

    const survivingEdge = entity.edges?.find((e) => e.source_id === newFact1.id)
    expect(survivingEdge?.target_id).toBe(newFact2.id)
  })

  it('drops an edge whose endpoint id is not in the map instead of leaving it dangling', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    expect(result.entities.char_new.edges).toHaveLength(1)
  })

  it('rewrites an event related_entry_id through the id map', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const entity = result.entities.char_new
    const [newFact1] = entity.facts
    const evt1 = entity.events.find((e) => e.id === 'evt_1')
    expect(evt1?.related_entry_id).toBe(newFact1.id)
  })

  it('leaves a null related_entry_id alone', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    const evt2 = result.entities.char_new.events.find((e) => e.id === 'evt_2')
    expect(evt2?.related_entry_id).toBeNull()
  })

  it('does not remap event ids themselves', () => {
    const result = remapOkfDumpIds(buildDump(), 'char_new')
    expect(result.entities.char_new.events.map((e) => e.id)).toEqual(['evt_1', 'evt_2'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utilities/__tests__/okfImportRemap.test.ts`
Expected: FAIL — `Cannot find module '../okfImportRemap'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/utilities/okfImportRemap.ts
import { randomUUID } from 'expo-crypto'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

export function remapOkfDumpIds(dump: MemoryDump, entityId: string): MemoryDump {
  const entity = dump.entities[entityId]
  if (!entity) return dump

  const idMap = new Map<string, string>()
  for (const fact of entity.facts) {
    idMap.set(fact.id, randomUUID())
  }
  for (const task of entity.tasks) {
    idMap.set(task.id, randomUUID())
  }

  const remappedFacts = entity.facts.map((fact) => ({
    ...fact,
    id: idMap.get(fact.id) ?? fact.id,
  }))
  const remappedTasks = entity.tasks.map((task) => ({
    ...task,
    id: idMap.get(task.id) ?? task.id,
  }))

  const remappedEdges = (entity.edges ?? []).flatMap((edge) => {
    const sourceId = idMap.get(edge.source_id)
    const targetId = idMap.get(edge.target_id)
    if (!sourceId || !targetId) return []
    return [{ ...edge, source_id: sourceId, target_id: targetId }]
  })

  const remappedEvents = entity.events.map((event) => {
    if (!event.related_entry_id) return event
    // Defensive: every fact/task in this entity was just remapped above, so
    // related_entry_id should always resolve. If it somehow doesn't, null it
    // out rather than leave a reference to an id that no longer exists.
    const remappedRelatedId = idMap.get(event.related_entry_id)
    return { ...event, related_entry_id: remappedRelatedId ?? null }
  })

  return {
    ...dump,
    entities: {
      ...dump.entities,
      [entityId]: {
        ...entity,
        facts: remappedFacts,
        tasks: remappedTasks,
        edges: remappedEdges,
        events: remappedEvents,
      },
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utilities/__tests__/okfImportRemap.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utilities/okfImportRemap.ts src/utilities/__tests__/okfImportRemap.test.ts
git commit -m "feat(okf): add id-remapping for cloning a character from a bundle"
```

---

## Task 3: Event Deduplication for Restore (`src/utilities/okfImportDedupe.ts`)

**Files:**
- Create: `src/utilities/okfImportDedupe.ts`
- Test: `src/utilities/__tests__/okfImportDedupe.test.ts`

Closes the gap documented in the spec ("Events duplicate on every restore"): `parseOkfBundle` regenerates every event id, and `EventRepository.addIgnoreDuplicate` only dedupes on `id`, so restoring the same backup twice (merge or replace — replace never clears events either) would duplicate every event without this filter. Dedup key: `(event_type, summary, UTC-day of created_at)`.

- [ ] **Step 1: Write the failing test file**

```typescript
// src/utilities/__tests__/okfImportDedupe.test.ts
import { dedupeEventsAgainstExisting } from '../okfImportDedupe'
import type { MemoryDump, WikiMemory } from '@equationalapplications/expo-llm-wiki'

function buildDump(events: unknown[]): MemoryDump {
  return {
    generatedAt: 1783094400000,
    entities: {
      char_1: { facts: [], tasks: [], events, edges: [] },
    },
  } as unknown as MemoryDump
}

describe('dedupeEventsAgainstExisting', () => {
  it('drops events whose (event_type, summary, UTC day) already exists on the target entity', async () => {
    const existingEvent = {
      id: 'evt_existing',
      entity_id: 'char_1',
      event_type: 'observation',
      summary: 'User mentioned liking coffee',
      created_at: Date.parse('2026-07-04T10:00:00.000Z'),
      related_entry_id: null,
    }
    const duplicateFromBundle = {
      id: 'evt_new_but_same', // parseOkfBundle always regenerates event ids
      entity_id: 'char_1',
      event_type: 'observation',
      summary: 'User mentioned liking coffee',
      created_at: Date.parse('2026-07-04T15:30:00.000Z'), // same UTC day, different time
      related_entry_id: null,
    }

    const mockWiki = {
      exportDump: jest.fn().mockResolvedValue(buildDump([existingEvent])),
    } as unknown as WikiMemory

    const result = await dedupeEventsAgainstExisting(
      mockWiki,
      'char_1',
      buildDump([duplicateFromBundle]),
    )

    expect(result.entities.char_1.events).toHaveLength(0)
  })

  it('keeps events that genuinely differ in type, summary, or day', async () => {
    const existingEvent = {
      id: 'evt_existing',
      entity_id: 'char_1',
      event_type: 'observation',
      summary: 'User mentioned liking coffee',
      created_at: Date.parse('2026-07-04T10:00:00.000Z'),
      related_entry_id: null,
    }
    const differentEvent = {
      id: 'evt_different',
      entity_id: 'char_1',
      event_type: 'decision',
      summary: 'User decided to switch to tea',
      created_at: Date.parse('2026-07-05T10:00:00.000Z'),
      related_entry_id: null,
    }

    const mockWiki = {
      exportDump: jest.fn().mockResolvedValue(buildDump([existingEvent])),
    } as unknown as WikiMemory

    const result = await dedupeEventsAgainstExisting(mockWiki, 'char_1', buildDump([differentEvent]))

    expect(result.entities.char_1.events).toHaveLength(1)
    expect((result.entities.char_1.events[0] as { id: string }).id).toBe('evt_different')
  })

  it('skips the existing-events lookup entirely when the bundle has no events', async () => {
    const mockWiki = { exportDump: jest.fn() } as unknown as WikiMemory

    const result = await dedupeEventsAgainstExisting(mockWiki, 'char_1', buildDump([]))

    expect(mockWiki.exportDump).not.toHaveBeenCalled()
    expect(result.entities.char_1.events).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/utilities/__tests__/okfImportDedupe.test.ts`
Expected: FAIL — `Cannot find module '../okfImportDedupe'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/utilities/okfImportDedupe.ts
import type { MemoryDump, WikiMemory } from '@equationalapplications/expo-llm-wiki'

function utcDayKey(createdAt: number): string {
  return new Date(createdAt).toISOString().slice(0, 10)
}

function eventDedupeKey(event: { event_type: string; summary: string; created_at: number }): string {
  return `${event.event_type}|${event.summary}|${utcDayKey(event.created_at)}`
}

export async function dedupeEventsAgainstExisting(
  wiki: WikiMemory,
  entityId: string,
  dump: MemoryDump,
): Promise<MemoryDump> {
  const entity = dump.entities[entityId]
  if (!entity || entity.events.length === 0) return dump

  const existingDump = await wiki.exportDump([entityId])
  const existingEvents = existingDump.entities[entityId]?.events ?? []
  const existingKeys = new Set(existingEvents.map(eventDedupeKey))

  const dedupedEvents = entity.events.filter((event) => !existingKeys.has(eventDedupeKey(event)))

  return {
    ...dump,
    entities: {
      ...dump.entities,
      [entityId]: {
        ...entity,
        events: dedupedEvents,
      },
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/utilities/__tests__/okfImportDedupe.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utilities/okfImportDedupe.ts src/utilities/__tests__/okfImportDedupe.test.ts
git commit -m "feat(okf): dedupe episodic events before a merge/replace restore"
```

---

## Task 4: Import Hook (`src/hooks/useImportCharacterOKF.ts`)

**Files:**
- Create: `src/hooks/useImportCharacterOKF.ts`
- Test: `src/hooks/__tests__/useImportCharacterOKF.test.ts`

Modeled on `src/hooks/useExportCharacterOKF.ts` (in-flight guard, `reportError` normalization). One correction versus the spec's own pseudocode: `handleCommitImport` returns `Promise<boolean>` instead of `Promise<void>`. The spec's sketch has it swallow all errors internally with no way for a caller to know whether the import actually succeeded — that's fine for the restore flow (edit screen just shows a toast either way), but the clone flow (Task 6) must not navigate to the new character's chat screen if the import into it failed. A boolean return is the minimal change that makes both call sites correct without adding a second signal.

- [ ] **Step 1: Write the failing test file**

```typescript
// src/hooks/__tests__/useImportCharacterOKF.test.ts
import { renderHook, act } from '@testing-library/react-native'
import { useImportCharacterOKF } from '../useImportCharacterOKF'
import * as okfImport from '~/utilities/okfImport'
import * as okfImportRemap from '~/utilities/okfImportRemap'
import * as okfImportDedupe from '~/utilities/okfImportDedupe'

class MockWikiBusyError extends Error {
  constructor(
    public operation: string,
    public entityId: string,
  ) {
    super(`Wiki busy: ${operation} on ${entityId}`)
    this.name = 'WikiBusyError'
  }
}

const mockImportDump = jest.fn()
const wiki = { importDump: mockImportDump, exportDump: jest.fn() }

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useWiki: () => wiki,
  parseOkfBundle: jest.fn(),
  WikiBusyError: MockWikiBusyError,
}))

jest.mock('~/utilities/okfImport')
jest.mock('~/utilities/okfImportRemap')
jest.mock('~/utilities/okfImportDedupe')
jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

import { parseOkfBundle } from '@equationalapplications/expo-llm-wiki'

const mockPickAndReadOkfBundle = jest.mocked(okfImport.pickAndReadOkfBundle)
const mockParseOkfBundle = jest.mocked(parseOkfBundle)
const mockRemapOkfDumpIds = jest.mocked(okfImportRemap.remapOkfDumpIds)
const mockDedupeEventsAgainstExisting = jest.mocked(okfImportDedupe.dedupeEventsAgainstExisting)

function buildDump(entityId: string) {
  return {
    generatedAt: 1783094400000,
    entities: {
      [entityId]: {
        facts: [{ id: 'fact_1' }],
        tasks: [{ id: 'task_1' }],
        events: [{ id: 'evt_1' }],
        edges: [{ id: 'edge_1' }],
      },
    },
  } as any
}

describe('useImportCharacterOKF', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDedupeEventsAgainstExisting.mockImplementation(async (_wiki, _id, dump) => dump)
    mockRemapOkfDumpIds.mockImplementation((dump) => dump)
  })

  it('previews counts from the parsed dump after picking a bundle', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    expect(result.current.preview).toEqual({ facts: 1, tasks: 1, events: 1, edges: 1 })
  })

  it('silently swallows a cancelled picker without setting an error', async () => {
    mockPickAndReadOkfBundle.mockRejectedValue(new okfImport.OkfPickCancelledError())

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    expect(result.current.error).toBeNull()
    expect(result.current.preview).toBeNull()
  })

  it('merge flow re-parses with the real target id, runs dedup, then imports with merge: true', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    let succeeded = false
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_1', 'merge')
    })

    expect(succeeded).toBe(true)
    expect(mockDedupeEventsAgainstExisting).toHaveBeenCalledWith(wiki, 'char_1', expect.anything())
    expect(mockRemapOkfDumpIds).not.toHaveBeenCalled()
    expect(mockImportDump).toHaveBeenCalledWith(expect.anything(), { merge: true })
    expect(result.current.didImport).toBe(true)
  })

  it('replace flow runs dedup then imports with merge: false', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })
    await act(async () => {
      await result.current.handleCommitImport('char_1', 'replace')
    })

    expect(mockDedupeEventsAgainstExisting).toHaveBeenCalled()
    expect(mockImportDump).toHaveBeenCalledWith(expect.anything(), { merge: false })
  })

  it('clone flow re-parses with the new character id, runs remap (not dedup), then imports with merge: true', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('placeholder'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('placeholder')
    })

    mockParseOkfBundle.mockReturnValue(buildDump('char_new'))
    mockImportDump.mockResolvedValue(undefined)

    let succeeded = false
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_new', 'clone')
    })

    expect(succeeded).toBe(true)
    expect(mockParseOkfBundle).toHaveBeenLastCalledWith('char_new', expect.anything())
    expect(mockRemapOkfDumpIds).toHaveBeenCalledWith(expect.anything(), 'char_new')
    expect(mockDedupeEventsAgainstExisting).not.toHaveBeenCalled()
    expect(mockImportDump).toHaveBeenCalledWith(expect.anything(), { merge: true })
  })

  it('surfaces a distinct retry message for WikiBusyError, returns false, without losing the original error', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockRejectedValue(new MockWikiBusyError('heal', 'char_1'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })

    let succeeded = true
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_1', 'merge')
    })

    expect(succeeded).toBe(false)
    expect(result.current.error?.message).toContain('Wiki busy')
    expect((result.current.error as Error & { displayMessage?: string })?.displayMessage).toBe(
      'Memory is busy right now — try again in a moment.',
    )
  })

  it('clears filesRef/preview on successful commit so a stale second commit is a no-op', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))
    mockImportDump.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })
    await act(async () => {
      await result.current.handleCommitImport('char_1', 'merge')
    })

    let secondSucceeded = true
    await act(async () => {
      secondSucceeded = await result.current.handleCommitImport('char_1', 'merge')
    })

    expect(secondSucceeded).toBe(false)
    expect(mockImportDump).toHaveBeenCalledTimes(1)
  })

  it('handleCancel clears preview, filesRef, and error so a later commit is a no-op', async () => {
    mockPickAndReadOkfBundle.mockResolvedValue([{ path: 'index.md', content: '# root' }])
    mockParseOkfBundle.mockReturnValue(buildDump('char_1'))

    const { result } = renderHook(() => useImportCharacterOKF())

    await act(async () => {
      await result.current.handlePickAndPreview('char_1')
    })
    act(() => {
      result.current.handleCancel()
    })

    expect(result.current.preview).toBeNull()
    expect(result.current.error).toBeNull()

    mockImportDump.mockResolvedValue(undefined)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.handleCommitImport('char_1', 'merge')
    })
    expect(succeeded).toBe(false)
    expect(mockImportDump).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/hooks/__tests__/useImportCharacterOKF.test.ts`
Expected: FAIL — `Cannot find module '../useImportCharacterOKF'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/hooks/useImportCharacterOKF.ts
import { useCallback, useRef, useState } from 'react'
import { useWiki, parseOkfBundle, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
import { pickAndReadOkfBundle, OkfPickCancelledError, type OkfFile } from '~/utilities/okfImport'
import { remapOkfDumpIds } from '~/utilities/okfImportRemap'
import { dedupeEventsAgainstExisting } from '~/utilities/okfImportDedupe'

export interface OkfPreviewStats {
  facts: number
  tasks: number
  events: number
  edges: number
}

export type ImportMode = 'merge' | 'replace' | 'clone'

export function useImportCharacterOKF() {
  const wiki = useWiki()
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [preview, setPreview] = useState<OkfPreviewStats | null>(null)
  const [error, setError] = useState<(Error & { displayMessage?: string }) | null>(null)
  const [didImport, setDidImport] = useState(false)
  // Cache raw files, not a parsed MemoryDump — the clone path doesn't know
  // the real target entity id until after the character record is created,
  // so parsing happens once at preview (display counts only) and again for
  // real at commit.
  const filesRef = useRef<OkfFile[] | null>(null)
  const inFlightRef = useRef(false)

  const handlePickAndPreview = useCallback(async (previewEntityId: string) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setIsParsing(true)
    setError(null)
    setPreview(null)
    setDidImport(false)
    try {
      const files = await pickAndReadOkfBundle()
      filesRef.current = files
      const dump = parseOkfBundle(previewEntityId, files)
      const entity = dump.entities[previewEntityId]
      setPreview({
        facts: entity?.facts.length ?? 0,
        tasks: entity?.tasks.length ?? 0,
        events: entity?.events.length ?? 0,
        edges: entity?.edges?.length ?? 0,
      })
    } catch (err) {
      if (err instanceof OkfPickCancelledError) return
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, 'okf-import:preview')
    } finally {
      inFlightRef.current = false
      setIsParsing(false)
    }
  }, [])

  const handleCommitImport = useCallback(
    async (targetEntityId: string, mode: ImportMode): Promise<boolean> => {
      if (!filesRef.current || inFlightRef.current) return false
      inFlightRef.current = true
      setIsImporting(true)
      setError(null)
      try {
        let dump = parseOkfBundle(targetEntityId, filesRef.current)
        if (mode === 'clone') {
          dump = remapOkfDumpIds(dump, targetEntityId)
        } else {
          dump = await dedupeEventsAgainstExisting(wiki, targetEntityId, dump)
        }
        await wiki.importDump(dump, mode === 'replace' ? { merge: false } : { merge: true })
        filesRef.current = null
        setPreview(null)
        setDidImport(true)
        return true
      } catch (err) {
        const normalized = err instanceof Error ? err : new Error(String(err))
        if (err instanceof WikiBusyError) {
          setError(
            Object.assign(normalized, {
              displayMessage: 'Memory is busy right now — try again in a moment.',
            }),
          )
        } else {
          setError(normalized)
        }
        reportError(normalized, `okf-import:${targetEntityId}`)
        return false
      } finally {
        inFlightRef.current = false
        setIsImporting(false)
      }
    },
    [wiki],
  )

  const handleCancel = useCallback(() => {
    filesRef.current = null
    setPreview(null)
    setError(null)
  }, [])

  return {
    isParsing,
    isImporting,
    preview,
    error,
    didImport,
    handlePickAndPreview,
    handleCommitImport,
    handleCancel,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/hooks/__tests__/useImportCharacterOKF.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useImportCharacterOKF.ts src/hooks/__tests__/useImportCharacterOKF.test.ts
git commit -m "feat(okf): add useImportCharacterOKF hook for restore/clone flows"
```

---

## Task 5: Restore UI in Character Edit Screen

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`

Adds an "Import OKF Backup" button next to the existing "Export Memory as OKF" button, a preview modal (reusing the same `Portal`/`Modal` pattern as the existing share modal), and a destructive confirmation for Replace via `Alert.alert` (already imported in this file). No new screen-level test file — mirrors the export feature's own precedent (no test file exists for the Export button either); this task closes with the manual verification in Step 5 instead.

- [ ] **Step 1: Add the hook import and destructure**

In `app/(drawer)/(tabs)/characters/[id]/edit.tsx`, add to the import block (after the `useExportCharacterOKF` import at line 32):

```typescript
import { useImportCharacterOKF } from '~/hooks/useImportCharacterOKF'
```

Directly after the existing `useExportCharacterOKF` destructure (around line 79):

```typescript
  const {
    preview: importPreview,
    isParsing: isImportParsing,
    isImporting,
    error: importError,
    didImport,
    handlePickAndPreview,
    handleCommitImport,
    handleCancel: handleImportCancel,
  } = useImportCharacterOKF()
  const prevDidImportRef = useRef(false)
```

- [ ] **Step 2: Add toast effects for import success/error**

Directly after the existing "Effect to handle navigation after saving" `useEffect` (ends around line 168), add:

```typescript
  useEffect(() => {
    if (didImport && !prevDidImportRef.current) {
      setToastState({ message: 'Import complete.', requiresSubscription: false })
    }
    prevDidImportRef.current = didImport
  }, [didImport])

  useEffect(() => {
    if (importError) {
      setToastState({
        message:
          (importError as Error & { displayMessage?: string }).displayMessage ?? importError.message,
        requiresSubscription: false,
      })
    }
  }, [importError])
```

- [ ] **Step 3: Add the Replace confirmation handler**

Near the other handler functions (e.g. alongside `handleOpenShareCard`/`handleWikiSync`), add:

```typescript
  const handleReplaceConfirm = () => {
    Alert.alert(
      'Replace Memory?',
      'This replaces all facts, tasks, and relationships with the contents of this backup. Timeline events are not cleared and will be added alongside existing ones. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            void handleCommitImport(characterId, 'replace')
          },
        },
      ],
    )
  }
```

- [ ] **Step 4: Add the Import button and preview Modal**

Directly after the existing Export button (the `Button` with `icon="export-variant"`, ending around line 561-569), add:

```tsx
          <Button
            mode="outlined"
            icon="import"
            onPress={() => handlePickAndPreview(characterId)}
            disabled={isImportParsing || isImporting}
            loading={isImportParsing}
            style={styles.shareButton}
          >
            Import OKF Backup
          </Button>
```

Inside the existing `<Portal>` block, directly after the share `<Modal>` closes (after `</Modal>`, before `</Portal>`, around line 635), add a second `Modal`:

```tsx
          <Modal
            visible={importPreview !== null}
            onDismiss={handleImportCancel}
            contentContainerStyle={[styles.shareModal, { backgroundColor: theme.colors.surface }]}
          >
            <Text variant="headlineSmall" style={styles.shareTitle}>
              Import OKF Backup
            </Text>
            <Text variant="bodyMedium" style={styles.shareCharacterName}>
              {importPreview
                ? `Ready to import ${importPreview.facts} facts, ${importPreview.tasks} tasks, ${importPreview.events} timeline events, ${importPreview.edges} relationships.`
                : ''}
            </Text>
            <Button
              mode="contained"
              onPress={() => {
                void handleCommitImport(characterId, 'merge')
              }}
              loading={isImporting}
              disabled={isImporting}
              style={styles.shareButton}
            >
              Merge Backup
            </Button>
            <Button
              mode="outlined"
              onPress={handleReplaceConfirm}
              loading={isImporting}
              disabled={isImporting}
              style={styles.shareButton}
            >
              Replace Memory
            </Button>
            <Button mode="text" onPress={handleImportCancel} disabled={isImporting}>
              Cancel
            </Button>
          </Modal>
```

- [ ] **Step 5: Manually verify**

Run: `npx expo start` and open a character's edit screen.
- Tap "Import OKF Backup", pick a previously-exported `.okf.zip` for a *different* character (or the same one) → preview modal shows fact/task/event/edge counts.
- Tap "Merge Backup" → toast reads "Import complete."; re-open the character's memory view and confirm facts/tasks appear.
- Repeat, tap "Replace Memory" → confirm the native `Alert` fires with the "cannot be undone" copy before anything happens.
- Cancel the picker mid-flow → no toast, no modal.

- [ ] **Step 6: Commit**

```bash
git add "app/(drawer)/(tabs)/characters/[id]/edit.tsx"
git commit -m "feat(okf): wire restore (merge/replace) UI into character edit screen"
```

---

## Task 6: Clone UI in Character List Screen

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/list.tsx`

Adds a "From Bundle" button next to the existing "New" button. Confirming creates the character directly via `createCharacter` (the plain async DB function at `src/database/characterDatabase.ts:127`, already used internally by the character machine's `createCharacterActor`) rather than through the fire-and-forget `useCreateCharacter()`/XState path — the clone flow needs the new character's id synchronously, in the same async function, to pass to `parseOkfBundle`/`importDump`; the XState `CREATE` event only surfaces the new id later via a `pendingCharacterId` selector meant for a different flow (the plain "New" button, which just navigates once it appears). After the direct insert, `characterService.send({ type: 'LOAD' })` resyncs the machine's in-memory `characters` list, since it doesn't know about a row inserted outside its own actor.

- [ ] **Step 1: Add imports**

In `app/(drawer)/(tabs)/characters/list.tsx`, update the `react-native-paper` import to add `Portal`, `Modal`, `useTheme`:

```typescript
import { Text, Button, ActivityIndicator, Snackbar, IconButton, Portal, Modal, useTheme } from 'react-native-paper'
```

Add these new imports:

```typescript
import { useAuthMachine } from '~/hooks/useMachines'
import { createCharacter } from '~/database/characterDatabase'
import { useImportCharacterOKF } from '~/hooks/useImportCharacterOKF'
import { reportError } from '~/utilities/reportError'
```

- [ ] **Step 2: Add state and hook wiring**

Inside `CharactersListScreen`, directly after the existing `useSyncCharacters()` destructure, add:

```typescript
  const { colors } = useTheme()
  const authService = useAuthMachine()
  const userId = useSelector(authService, (state) => state.context.user?.uid ?? null)
  const {
    preview: importPreview,
    isParsing: isImportParsing,
    isImporting,
    error: importError,
    handlePickAndPreview,
    handleCommitImport,
    handleCancel: handleImportCancel,
  } = useImportCharacterOKF()
  const [isCreatingClone, setIsCreatingClone] = useState(false)
```

Add the placeholder entity id constant above the component (module scope, alongside no other constants currently in this file — add near the top, after the imports):

```typescript
// Preview needs *some* entity id to key parseOkfBundle's dump by; the real
// character doesn't exist until the user confirms (see handleConfirmClone).
// Preview counts are id-independent (array lengths only), so any string works.
const OKF_CLONE_PREVIEW_ENTITY_ID = 'okf-clone-preview'
```

- [ ] **Step 3: Add the clone handlers**

Directly after `handleCreateCharacter`, add:

```typescript
  const handleCreateFromBundle = () => {
    handlePickAndPreview(OKF_CLONE_PREVIEW_ENTITY_ID)
  }

  const handleConfirmClone = async () => {
    if (!userId) return
    setIsCreatingClone(true)
    try {
      const newCharacter = await createCharacter(userId, {
        name: 'Imported Character',
        is_public: false,
      })
      if (!newCharacter) throw new Error('Failed to create character')
      characterService.send({ type: 'LOAD' })
      const imported = await handleCommitImport(newCharacter.id, 'clone')
      if (imported) {
        router.push(`/chat/${newCharacter.id}`)
      }
    } catch (err) {
      reportError(err, 'okf-clone:create')
      setToastState({
        message: 'Failed to create character from bundle.',
        requiresSubscription: false,
      })
    } finally {
      setIsCreatingClone(false)
    }
  }
```

- [ ] **Step 4: Add an error toast effect**

Directly after the existing `useEffect` that sets `toastState` for cloud sync errors, add:

```typescript
  useEffect(() => {
    if (importError) {
      setToastState({
        message:
          (importError as Error & { displayMessage?: string }).displayMessage ?? importError.message,
        requiresSubscription: false,
      })
    }
  }, [importError])
```

- [ ] **Step 5: Add the button and Modal**

In the `headerActions` `View`, directly after the existing "New" `Button`, add:

```tsx
          <Button
            mode="outlined"
            icon="file-import-outline"
            onPress={handleCreateFromBundle}
            disabled={isImportParsing || isImporting || isCreatingClone}
            loading={isImportParsing}
          >
            From Bundle
          </Button>
```

Directly after the closing `</Snackbar>` (end of the returned JSX, before the final `</View>`), add:

```tsx
      <Portal>
        <Modal
          visible={importPreview !== null}
          onDismiss={handleImportCancel}
          contentContainerStyle={[styles.cloneModal, { backgroundColor: colors.surface }]}
        >
          <Text variant="headlineSmall" style={styles.cloneModalTitle}>
            Create Character from Bundle
          </Text>
          <Text variant="bodyMedium">
            {importPreview
              ? `Ready to import ${importPreview.facts} facts, ${importPreview.tasks} tasks, ${importPreview.events} timeline events, ${importPreview.edges} relationships into a new character.`
              : ''}
          </Text>
          <Button
            mode="contained"
            onPress={() => {
              void handleConfirmClone()
            }}
            loading={isImporting || isCreatingClone}
            disabled={isImporting || isCreatingClone}
            style={styles.cloneModalButton}
          >
            Create Character
          </Button>
          <Button mode="text" onPress={handleImportCancel} disabled={isImporting || isCreatingClone}>
            Cancel
          </Button>
        </Modal>
      </Portal>
```

- [ ] **Step 6: Add the new styles**

In the `StyleSheet.create` block at the bottom of the file, add:

```typescript
  cloneModal: {
    margin: 24,
    padding: 24,
    borderRadius: 12,
    gap: 12,
  },
  cloneModalTitle: {
    fontWeight: 'bold',
  },
  cloneModalButton: {
    marginTop: 8,
  },
```

- [ ] **Step 7: Manually verify**

Run: `npx expo start` and open the characters list screen.
- Tap "From Bundle", pick a previously-exported `.okf.zip` → preview modal shows counts and "Create Character from Bundle" title.
- Tap "Create Character" → a new character appears in the list named "Imported Character"; app navigates to its chat screen.
- Open that character's memory view and confirm the facts/tasks from the bundle are present under new ids (not the source character's original ids — verifies the remap actually ran).
- With the *source* character for that same bundle still present on-device, confirm no `_warnCrossEntityCollision` console warning fires during the clone (open Metro logs) — this is the actual regression this whole remap step exists to prevent.

- [ ] **Step 8: Commit**

```bash
git add "app/(drawer)/(tabs)/characters/list.tsx"
git commit -m "feat(okf): wire clone (create-from-bundle) UI into character list screen"
```

---

## Task 7: Developer Documentation

**Files:**
- Create: `docs/okf-import-export.md`
- Modify: `README.md`
- Modify: `docs/ai-and-chat.md`

- [ ] **Step 1: Write the developer doc**

```markdown
<!-- docs/okf-import-export.md -->
# OKF Import & Export

Clanker can export a character's complete memory graph (facts, tasks, episodic
events, and graph edges) to an OKF (Open Knowledge Format) zip bundle, and
import that bundle back in — either restoring it into the same character or
cloning it into a brand-new one.

See `docs/superpowers/specs/2026-07-03-okf-export-design.md` and
`docs/superpowers/specs/2026-07-04-okf-import-support-design.md` for the full
design history and verification notes. This page is the quick-reference.

## Bundle Layout

```text
index.md
README.md
entities/
  {characterId}/
    index.md
    log.md
    facts/{factId}.md
    tasks/{taskId}.md
```

## Restore vs. Clone

| Mode | Target | Behavior |
|------|--------|----------|
| Merge (default) | existing character | Upserts facts/tasks whose imported `updated_at` is newer than the local row. Events/edges are inserted if new (by id/tuple), never updated. |
| Replace | existing character | Soft-deletes existing facts/tasks, hard-deletes edges, before importing. **Events are never cleared in either mode** — there is no bulk-delete for events in the underlying package. |
| Clone | brand-new character | Regenerates fact/task ids before import (see ID Remapping) so the new character's rows can't collide with the source character's still-existing rows. |

## Known Gaps in the Underlying Package

- **Replace doesn't clear events.** `ImportExportService.doImportEntity` has no
  bulk-delete for events in either merge or replace mode. UI copy for
  "Replace Memory" must say "facts, tasks, and relationships" — never
  "everything."
- **Events duplicate on every restore without dedup.** `parseOkfBundle`
  regenerates every event's `id` on each parse, and the events table has no
  uniqueness constraint beyond `id` (unlike edges, which have
  `UNIQUE(entity_id, source_id, target_id, edge_type)`). `okfImportDedupe.ts`
  works around this by filtering events whose `(event_type, summary, UTC-day
  of created_at)` tuple already exists on the target entity before import.
- **Cross-entity id collision is silently skipped, not merged or overwritten.**
  `doImportEntity` looks up each fact/task id across the *entire* local
  database, not scoped to the importing entity. If a row with that id exists
  under a different, still-live entity, the import skips it — no exception,
  no count of what was skipped. This is why cloning requires
  `okfImportRemap.ts`: without it, cloning a character while its source is
  still on-device would silently produce a near-empty clone.

## ID Remapping for Cloning (`src/utilities/okfImportRemap.ts`)

`remapOkfDumpIds(dump, newCharacterId)` regenerates every fact/task id via
`randomUUID()`, rewrites edge `source_id`/`target_id` through the resulting
map (dropping any edge whose endpoint isn't in the map), and rewrites event
`related_entry_id` the same way. Event ids themselves are never touched —
`parseOkfBundle` already regenerates them on every parse, so there's no old
event id to collide with in the first place.

## Untrusted Input Caps (`src/utilities/okfImport.ts`)

Before any content reaches `parseOkfBundle`: raw zip file size capped at
`MAX_OKF_ZIP_RAW_BYTES` (50MB), entry count capped at `MAX_OKF_ZIP_ENTRIES`
(5,000), and total decompressed content capped at
`MAX_OKF_TOTAL_UNCOMPRESSED_BYTES` (100MB) — checked against a running total
of actual decompressed length, not just the zip's (attacker-controlled)
declared size metadata. Paths are filtered to an exact allow-list
(`index.md`, `entities/{id}/index.md`, `entities/{id}/log.md`,
`entities/{id}/facts/*.md`, `entities/{id}/tasks/*.md`) — this excludes the
export bundle's own `README.md`, which would otherwise parse as a junk fact
with `id: "README"` (`resolveRoute`'s fallback in `core-llm-wiki` treats any
unrecognized concept-file path as a fact). Bundles containing more than one
`entities/{id}/` directory are rejected — V1 only supports single-character
bundles.
```

- [ ] **Step 2: Link it from README.md**

Search `README.md` for the export feature's existing doc link (or its
"Memory"/"LLM Wiki" section) and add a line pointing to the new doc:

```markdown
- [OKF Import & Export](docs/okf-import-export.md) — restore or clone a character's memory from a portable backup
```

- [ ] **Step 3: Link it from docs/ai-and-chat.md**

In the LLM Wiki section of `docs/ai-and-chat.md`, add a reference:

```markdown
See [OKF Import & Export](okf-import-export.md) for the restore/clone bundle format and its known gaps.
```

- [ ] **Step 4: Commit**

```bash
git add docs/okf-import-export.md README.md docs/ai-and-chat.md
git commit -m "docs(okf): add developer reference for import/export, restore, and clone"
```

---

## Task 8: Public & User-Facing Documentation

**Files:**
- Modify: `public/memory-export-with-okf/index.html`
- Modify: `src/components/LandingPage/FeaturesSection.tsx`
- Modify: `app/support.tsx`
- Modify: `src/config/privacyConfig.ts`
- Modify: `src/constants/okfReadmeContent.ts`

- [ ] **Step 1: Retitle and extend the public explainer page**

In `public/memory-export-with-okf/index.html`:

Change the `<title>` (line 6):

```html
  <title>Import and Export Character Memory with OKF - Equational Applications</title>
```

Change the `<h1>` (line 40):

```html
  <h1>Import and Export Your Character's Memory with OKF</h1>
```

Replace the "Re-import Later" section (lines 97-101) — it currently says this is a future capability, which is no longer true:

```html
  <h3>Restore or Clone</h3>
  <p>
    Bring a bundle back into Clanker two ways: <strong>restore</strong> it into
    the same character (merge new facts in, or replace existing facts/tasks
    entirely), or <strong>clone</strong> it into a brand-new character seeded
    with everything from the bundle. Look for <strong>Import OKF Backup</strong>
    in a character's settings, or <strong>From Bundle</strong> on the
    characters list.
  </p>
```

- [ ] **Step 2: Update the landing page feature card**

In `src/components/LandingPage/FeaturesSection.tsx`, update the `body` of the
`'Own Your Data'` feature entry:

```typescript
    body: 'Export any character\'s complete memory - facts, tasks, and history - as an open, standard format (OKF), and bring it back anytime: restore a backup into the same character, or clone it into a brand-new one. No walled garden. Your data works with any OKF-compatible tool.',
```

- [ ] **Step 3: Extend the support FAQ**

In `app/support.tsx`, extend the existing OKF FAQ answer (the `Text` following
`"Can I export my character's memory?"`):

```tsx
          <Text variant="bodyMedium" style={styles.bodyText}>
            {'Yes - open Character Settings and tap "Export Memory as OKF" to download a '}
            complete, standard-format backup of everything your character knows, including
            its facts, tasks, and how they connect. Bring it back anytime with{' '}
            {'"Import OKF Backup" (restore into the same character) or "From Bundle" on the '}
            characters list (clone into a new one).
          </Text>
```

- [ ] **Step 4: Extend the privacy policy**

In `src/config/privacyConfig.ts`, extend the "Data Portability" paragraph:

```typescript
Data Portability
You can export your character's complete memory (facts, tasks, and interaction
history, including how they relate to each other) at any time from Character
Settings, in the Open Knowledge Format (OKF), an open standard. This self-serve
export contains everything associated with that character's memory. You retain
full control of your exported data. You can also bring an exported bundle back
in at any time — restoring it into the same character, or using it to create a
new one.
```

Bump the version and date:

```typescript
export const PRIVACY: PrivacyConfig = {
  version: '1.7',
  lastUpdated: 'July 4, 2026',
```

- [ ] **Step 5: Update the bundle's own README content**

In `src/constants/okfReadmeContent.ts`, replace the "4. Future Re-import"
section — the capability now exists, so "future" is no longer accurate:

```typescript
### 4. Restore or Clone

Bring this bundle back into Clanker any time from a character's settings
("Import OKF Backup") or the characters list ("From Bundle"). Restoring
merges new facts in (or replaces existing facts/tasks, if you choose Replace)
into the *same* character; creating from a bundle clones everything into a
*new* character instead.
```

Update the "What's Not Included (V1)" section's ontology line is unaffected —
leave as-is (ontology import remains Phase 2 per the spec's Non-Goals).

- [ ] **Step 6: Commit**

```bash
git add public/memory-export-with-okf/index.html src/components/LandingPage/FeaturesSection.tsx app/support.tsx src/config/privacyConfig.ts src/constants/okfReadmeContent.ts
git commit -m "docs(okf): update public docs, FAQ, privacy policy, and bundle README for import support"
```

---

## Task 9: Full CI Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all three pass with no errors. If `npm run test` reports failures
outside the files touched by this plan, stop and investigate before
proceeding — do not silence or skip unrelated failing tests.

- [ ] **Step 2: Manually verify the round trip end-to-end**

Using a real device or simulator (`npx expo start`):
1. Export a character with a nontrivial memory graph (several facts, at least
   one edge between two facts) via the existing "Export Memory as OKF" button.
2. Import that same bundle back into the *same* character via "Merge Backup"
   → confirm no duplicate events appear in the memory view (this is the
   dedup gap the spec identified — the regression this whole feature guards
   against).
3. Import that same bundle into a *new* character via "From Bundle" while the
   original character is still on-device → confirm the new character actually
   has the facts/tasks (not an empty clone — this is the collision-guard
   regression the remap step exists to prevent).

This step has no automated equivalent — `importDump`'s cross-entity collision
guard only manifests against a real local SQLite database with both
characters present simultaneously, which the Jest unit tests mock around
rather than exercise directly.
