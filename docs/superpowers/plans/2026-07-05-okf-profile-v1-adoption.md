# OKF Profile v1 Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `@equationalapplications/{expo,core}-llm-wiki` ^4.19.0 (OKF profile v1): delete the redundant edge-augmentation pass, make event dedup id-first with per-event tuple fallback, regenerate event ids on clone (prevents silent timeline loss), inherit summary round-trip, and surface profile/summary in the import preview UX.

**Architecture:** The package now does the format work (profile key, `## Related`, event id comments, summary parse/emit, allow-list, multi-entity throw). Clanker keeps its zip safeguards and friendly pre-checks, rewires `okfImportDedupe`/`okfImportRemap` for id-preserving events, and adds small pure utils (`scanExplicitEventIds`, `detectOkfProfile`, `markdownToPlainSnippet`) threaded through `useImportCharacterOKF` into the preview modals.

**Tech Stack:** Expo/React Native + TypeScript, jest + @testing-library/react-native (hooks mock `expo-llm-wiki`; utils tested pure, real `parseOkfBundle` allowed in util tests), react-native-paper UI.

**Spec:** `docs/superpowers/specs/2026-07-05-okf-profile-v1-adoption-design.md`
**Prerequisite:** expo-llm-wiki **4.19.0 on npm** (summary-persistence plan merged + released). Do not start before that.

---

### Task 1: Bump both packages to ^4.19.0

**Files:**
- Modify: `package.json:41-42`

- [ ] **Step 1: Edit versions**

In `package.json`, change:

```json
    "@equationalapplications/core-llm-wiki": "^4.19.0",
    "@equationalapplications/expo-llm-wiki": "^4.19.0",
```

- [ ] **Step 2: Install and verify resolved version**

Run: `npm install && npm ls @equationalapplications/core-llm-wiki @equationalapplications/expo-llm-wiki`
Expected: both resolve to 4.19.x, no peer warnings.

- [ ] **Step 3: Typecheck + existing tests**

Run: `npm run typecheck && npm run test -- src/utilities src/utils src/hooks`
Expected: typecheck clean. Tests may already show failures in `okfImportRemap.test.ts`/`okfImportDedupe.test.ts`-adjacent integration if any test feeds real `parseOkfBundle` output (event ids now stable). Note failures; they are fixed by Tasks 4–6 — do not "fix" them by loosening assertions here.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump expo-llm-wiki and core-llm-wiki to ^4.19.0 (OKF profile v1)"
```

---

### Task 2: Vendor conformance fixtures with checksum guard

**Files:**
- Create: `src/utilities/__tests__/fixtures/golden-v1/**` and `src/utilities/__tests__/fixtures/legacy-profile-0/**` (copied verbatim from the expo-llm-wiki repo `packages/okf/fixtures/`)
- Create: `src/utilities/__tests__/okfFixtures.ts` (loader)
- Test: `src/utilities/__tests__/okfFixtures.test.ts` (checksum drift guard)

- [ ] **Step 1: Copy fixtures**

```bash
cp -R ../expo-llm-wiki/packages/okf/fixtures/golden-v1 src/utilities/__tests__/fixtures/
cp -R ../expo-llm-wiki/packages/okf/fixtures/legacy-profile-0 src/utilities/__tests__/fixtures/
```

(Path relative to the clanker repo root; adjust if the sibling checkout lives elsewhere.)

- [ ] **Step 2: Write the loader**

`src/utilities/__tests__/okfFixtures.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { OkfFile } from '../okfImport'

const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures')

function walkMd(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry}` : entry
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) return walkMd(full, rel)
    return rel.endsWith('.md') ? [rel] : []
  })
}

export function loadOkfFixture(name: 'golden-v1' | 'legacy-profile-0'): OkfFile[] {
  const root = path.join(FIXTURES_ROOT, name)
  return walkMd(root)
    .sort()
    .map((rel) => ({ path: rel, content: fs.readFileSync(path.join(root, rel), 'utf8') }))
}

export function fixtureChecksum(name: 'golden-v1' | 'legacy-profile-0'): string {
  const hash = crypto.createHash('sha256')
  for (const file of loadOkfFixture(name)) {
    hash.update(file.path)
    hash.update('\u0000')
    hash.update(file.content)
    hash.update('\u0000')
  }
  return hash.digest('hex')
}
```

- [ ] **Step 3: Compute the checksums once**

Add a temporary test to the (not yet created) `okfFixtures.test.ts`, run it once, and copy the printed values into Step 4's literals:

```typescript
it('TEMP: print checksums', () => {
  console.log('golden-v1:', fixtureChecksum('golden-v1'))
  console.log('legacy-profile-0:', fixtureChecksum('legacy-profile-0'))
})
```

Run: `npm run test -- src/utilities/__tests__/okfFixtures.test.ts`
Copy both hex strings from the output, then delete this temporary test.

- [ ] **Step 4: Write the drift-guard test**

`src/utilities/__tests__/okfFixtures.test.ts`:

```typescript
import { fixtureChecksum, loadOkfFixture } from './okfFixtures'

// Vendored from expo-llm-wiki packages/okf/fixtures (profile doc §9: non-source
// copies are checksummed so silent drift between repos fails loudly). When the
// upstream fixtures change intentionally, re-copy and update these values.
const GOLDEN_V1_SHA256 = '<paste value from Step 3>'
const LEGACY_PROFILE_0_SHA256 = '<paste value from Step 3>'

describe('vendored OKF fixtures', () => {
  it('golden-v1 matches the recorded checksum', () => {
    expect(fixtureChecksum('golden-v1')).toBe(GOLDEN_V1_SHA256)
  })

  it('legacy-profile-0 matches the recorded checksum', () => {
    expect(fixtureChecksum('legacy-profile-0')).toBe(LEGACY_PROFILE_0_SHA256)
  })

  it('golden-v1 root index carries the profile key', () => {
    const root = loadOkfFixture('golden-v1').find((f) => f.path === 'index.md')!
    expect(root.content).toMatch(/^profile:\s*llm-wiki\/1\s*$/m)
  })

  it('legacy-profile-0 root index has no profile key', () => {
    const root = loadOkfFixture('legacy-profile-0').find((f) => f.path === 'index.md')!
    expect(root.content).not.toContain('profile:')
  })
})
```

- [ ] **Step 5: Run**

Run: `npm run test -- src/utilities/__tests__/okfFixtures.test.ts`
Expected: PASS with real checksum literals pasted in (and the temporary console test deleted).

- [ ] **Step 6: Commit**

```bash
git add src/utilities/__tests__/fixtures src/utilities/__tests__/okfFixtures.ts src/utilities/__tests__/okfFixtures.test.ts
git commit -m "test: vendor OKF conformance fixtures with checksum drift guard"
```

---

### Task 3: Delete `augmentWithEdgeLinks`

**Files:**
- Delete: `src/utils/augmentWithEdgeLinks.ts`, `src/utils/__tests__/augmentWithEdgeLinks.test.ts`
- Modify: `src/hooks/useExportCharacterOKF.ts:4,44-49`
- Modify (as needed): `src/hooks/__tests__/useExportCharacterOKF.integration.test.ts`

- [ ] **Step 1: Remove the call site**

In `src/hooks/useExportCharacterOKF.ts`: delete line 4 (`import { augmentWithEdgeLinks } ...`) and replace lines 44–49 with:

```typescript
      const { files } = formatOkfBundle(dump)
      const filesWithReadme: OkfFile[] = [
        ...files,
        { path: 'README.md', content: buildOkfReadmeContent() },
      ]
```

(The package emits `## Related`, the profile key, event id comments, and summary natively as of 4.18.x — a call-site pass would double-append the edge section.)

- [ ] **Step 2: Delete the util and its test**

```bash
git rm src/utils/augmentWithEdgeLinks.ts src/utils/__tests__/augmentWithEdgeLinks.test.ts
```

- [ ] **Step 3: Fix the export integration test**

Run: `npm run test -- src/hooks/__tests__/useExportCharacterOKF.integration.test.ts`
The test mocks `formatOkfBundle`; assertions that expected an appended `## Related` section in the zipped files will fail. Update them to assert the zipped files equal the mock's `files` plus the README entry — the edge content is now the (mocked) package's responsibility, not the hook's. Do not delete the round-trip intent: Task 2's fixtures + upstream conformance tests own it now.
Expected after edits: PASS.

- [ ] **Step 4: Typecheck + grep for stragglers**

Run: `npm run typecheck && grep -rn "augmentWithEdgeLinks" src app`
Expected: typecheck clean, grep empty.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: drop call-site edge augmentation — package emits ## Related natively"
```

---

### Task 4: `scanExplicitEventIds` + preview utils

**Files:**
- Modify: `src/utilities/okfImportDedupe.ts` (add scan util)
- Create: `src/utilities/okfPreview.ts`
- Test: `src/utilities/__tests__/okfImportDedupe.test.ts` (extend), `src/utilities/__tests__/okfPreview.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Append to `src/utilities/__tests__/okfImportDedupe.test.ts`:

```typescript
import { scanExplicitEventIds } from '../okfImportDedupe'
import { loadOkfFixture } from './okfFixtures'

describe('scanExplicitEventIds', () => {
  it('collects every id from a multi-line log, not just the last (multiline anchoring)', () => {
    const files = [
      {
        path: 'entities/e1/log.md',
        content: [
          '## 2026-07-05',
          '',
          '- (observation) First <!-- id: evt_one -->',
          '- (observation) No id on this line',
          '- (action) Third   <!--   id:   evt_three   -->  ',
        ].join('\n'),
      },
    ]
    expect(scanExplicitEventIds(files)).toEqual(new Set(['evt_one', 'evt_three']))
  })

  it('finds ids in the golden-v1 fixture log', () => {
    const ids = scanExplicitEventIds(loadOkfFixture('golden-v1'))
    expect(ids).toEqual(new Set(['evt_golden_1', 'evt_golden_2']))
  })

  it('finds none in the legacy-profile-0 fixture', () => {
    expect(scanExplicitEventIds(loadOkfFixture('legacy-profile-0')).size).toBe(0)
  })

  it('ignores non-log files', () => {
    const files = [{ path: 'entities/e1/facts/f.md', content: 'x <!-- id: evt_nope -->' }]
    expect(scanExplicitEventIds(files).size).toBe(0)
  })
})
```

Create `src/utilities/__tests__/okfPreview.test.ts`:

```typescript
import { detectOkfProfile, markdownToPlainSnippet } from '../okfPreview'
import { loadOkfFixture } from './okfFixtures'

describe('detectOkfProfile', () => {
  it('detects llm-wiki/1 on the golden fixture', () => {
    expect(detectOkfProfile(loadOkfFixture('golden-v1'))).toBe('llm-wiki/1')
  })

  it('reports legacy for profile-0 fixture', () => {
    expect(detectOkfProfile(loadOkfFixture('legacy-profile-0'))).toBe('legacy')
  })

  it('reports legacy when the root index is missing', () => {
    expect(detectOkfProfile([])).toBe('legacy')
  })
})

describe('markdownToPlainSnippet', () => {
  it('strips markdown syntax so a slice cannot break rendering', () => {
    const md = '# Title\n\nThis is **bold**, a [link](https://x.example), `code`, and _emphasis_.\n\n- item one\n- item two'
    const snippet = markdownToPlainSnippet(md)
    expect(snippet).toBe('Title This is bold, a link, code, and emphasis. item one item two')
    expect(snippet).not.toMatch(/[*_[\]#`]/)
  })

  it('caps length on the stripped plain text with an ellipsis', () => {
    const snippet = markdownToPlainSnippet('word '.repeat(100), 20)
    expect(snippet.length).toBeLessThanOrEqual(21) // 20 + ellipsis
    expect(snippet.endsWith('…')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/utilities/__tests__/okfImportDedupe.test.ts src/utilities/__tests__/okfPreview.test.ts`
Expected: FAIL — functions don't exist.

- [ ] **Step 3: Implement**

In `src/utilities/okfImportDedupe.ts`, add (top of file, after imports):

```typescript
import type { OkfFile } from '~/utilities/okfImport'

// Profile §7 id-comment grammar. The $ anchors per LINE — the m flag is
// load-bearing: without it this matches at most one id (end of file).
const EVENT_ID_COMMENT_PATTERN = /<!--\s*id:\s*(\S+)\s*-->\s*$/gm

/**
 * Explicit event ids present in the bundle's log.md as id comments.
 * Events whose parsed id is in this set carry profile-1 identity; events
 * outside it got a freshly generated id from parseOkfBundle and need the
 * tuple fallback.
 */
export function scanExplicitEventIds(files: readonly OkfFile[]): Set<string> {
  const ids = new Set<string>()
  for (const file of files) {
    if (file.path !== 'log.md' && !file.path.endsWith('/log.md')) continue
    for (const match of file.content.matchAll(EVENT_ID_COMMENT_PATTERN)) {
      ids.add(match[1])
    }
  }
  return ids
}
```

Create `src/utilities/okfPreview.ts`:

```typescript
import type { OkfFile } from '~/utilities/okfImport'

export type OkfProfile = 'llm-wiki/1' | 'legacy'

/** Display-only profile detection from the root index frontmatter (no behavior branches on it). */
export function detectOkfProfile(files: readonly OkfFile[]): OkfProfile {
  const root = files.find((f) => f.path === 'index.md')
  if (!root) return 'legacy'
  return /^profile:\s*["']?llm-wiki\/1["']?\s*$/m.test(root.content) ? 'llm-wiki/1' : 'legacy'
}

/**
 * Markdown → plain-text snippet. A naive slice of raw markdown can cut a
 * token in half (unclosed **, dangling [) and break rendering; strip first,
 * cap after. Regex pass, not a markdown library — preview-quality is enough.
 */
export function markdownToPlainSnippet(markdown: string, maxChars = 200): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/(^|\s)[*_](\S(?:[^*_]*\S)?)[*_](?=\s|[.,!?;:]|$)/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxChars) return plain
  return `${plain.slice(0, maxChars).trimEnd()}…`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/utilities/__tests__/okfImportDedupe.test.ts src/utilities/__tests__/okfPreview.test.ts`
Expected: PASS. If the exact-string snippet assertion fails on emphasis edge cases, fix the regex, not the assertion — the invariant is "no markdown syntax characters survive".

- [ ] **Step 5: Commit**

```bash
git add src/utilities/okfImportDedupe.ts src/utilities/okfPreview.ts src/utilities/__tests__/okfImportDedupe.test.ts src/utilities/__tests__/okfPreview.test.ts
git commit -m "feat: add event-id scan and profile/summary preview utils"
```

---

### Task 5: Id-first dedup with per-event tuple fallback

**Files:**
- Modify: `src/utilities/okfImportDedupe.ts` (`dedupeEventsAgainstExisting`)
- Test: `src/utilities/__tests__/okfImportDedupe.test.ts`

- [ ] **Step 1: Write the failing tests**

The existing tests call `dedupeEventsAgainstExisting(wiki, entityId, dump)`. The signature gains a required fourth argument. Update existing calls to pass `new Set<string>()` (pure legacy behavior — assertions unchanged), then add:

```typescript
describe('id-first dedup (profile v1)', () => {
  const baseEvent = (id: string, summary: string) => ({
    id,
    entity_id: 'e1',
    event_type: 'observation',
    summary,
    related_entry_id: null,
    created_at: Date.parse('2026-07-05T00:00:00.000Z'),
  })

  const wikiWithExisting = (events: unknown[]) =>
    ({
      exportDump: jest.fn().mockResolvedValue({
        generatedAt: 0,
        entities: { e1: { facts: [], tasks: [], events, edges: [] } },
      }),
    }) as never

  const dumpWithEvents = (events: unknown[]) =>
    ({
      generatedAt: 0,
      entities: { e1: { facts: [], tasks: [], events, edges: [] } },
    }) as never

  it('passes id-carrying events through even when tuple-identical to existing ones', async () => {
    const wiki = wikiWithExisting([baseEvent('evt_existing', 'Same summary')])
    const dump = dumpWithEvents([baseEvent('evt_new', 'Same summary')])
    const result = await dedupeEventsAgainstExisting(wiki, 'e1', dump, new Set(['evt_new']))
    expect(result.entities.e1.events.map((e: { id: string }) => e.id)).toEqual(['evt_new'])
  })

  it('tuple-dedupes events without explicit ids', async () => {
    const wiki = wikiWithExisting([baseEvent('evt_existing', 'Same summary')])
    const dump = dumpWithEvents([baseEvent('evt_regenerated', 'Same summary')])
    const result = await dedupeEventsAgainstExisting(wiki, 'e1', dump, new Set())
    expect(result.entities.e1.events).toEqual([])
  })

  it('handles mixed bundles per event', async () => {
    const wiki = wikiWithExisting([baseEvent('evt_a', 'Dup summary')])
    const dump = dumpWithEvents([
      baseEvent('evt_stable', 'Dup summary'), // explicit id → keep
      baseEvent('evt_fresh1', 'Dup summary'), // regenerated → tuple-dropped
      baseEvent('evt_fresh2', 'Unique summary'), // regenerated → tuple-kept
    ])
    const result = await dedupeEventsAgainstExisting(wiki, 'e1', dump, new Set(['evt_stable']))
    expect(result.entities.e1.events.map((e: { id: string }) => e.id)).toEqual([
      'evt_stable',
      'evt_fresh2',
    ])
  })

  it('skips the exportDump read entirely when every event carries an explicit id', async () => {
    const wiki = wikiWithExisting([])
    const dump = dumpWithEvents([baseEvent('evt_x', 'S')])
    await dedupeEventsAgainstExisting(wiki, 'e1', dump, new Set(['evt_x']))
    expect((wiki as { exportDump: jest.Mock }).exportDump).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/utilities/__tests__/okfImportDedupe.test.ts`
Expected: FAIL — extra argument ignored / all events tuple-deduped.

- [ ] **Step 3: Implement**

Replace `dedupeEventsAgainstExisting` in `src/utilities/okfImportDedupe.ts`:

```typescript
export async function dedupeEventsAgainstExisting(
  wiki: WikiMemory,
  entityId: string,
  dump: MemoryDump,
  explicitEventIds: ReadonlySet<string>,
): Promise<MemoryDump> {
  const entity = dump.entities[entityId]
  if (!entity || entity.events.length === 0) return dump

  // Profile §7: an explicit id IS the event's identity — the events table's
  // INSERT OR IGNORE on the id primary key makes re-import a no-op, and two
  // distinct profile-1 events may legitimately share the tuple. Only events
  // whose id was regenerated by parseOkfBundle (legacy bundles, stripped
  // comments) need the tuple fallback.
  const needsTupleCheck = entity.events.some((event) => !explicitEventIds.has(event.id))
  if (!needsTupleCheck) return dump

  const existingDump = await wiki.exportDump([entityId])
  const existingEvents = existingDump.entities[entityId]?.events ?? []
  const existingKeys = new Set(existingEvents.map(eventDedupeKey))

  const dedupedEvents = entity.events.filter(
    (event) => explicitEventIds.has(event.id) || !existingKeys.has(eventDedupeKey(event)),
  )

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

(Keep `utcDayKey`/`eventDedupeKey` exactly as they are — profile-0 bundles exist forever.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/utilities/__tests__/okfImportDedupe.test.ts`
Expected: PASS, including the pre-existing tuple tests (now passing `new Set()`).

- [ ] **Step 5: Commit**

```bash
git add src/utilities/okfImportDedupe.ts src/utilities/__tests__/okfImportDedupe.test.ts
git commit -m "feat: id-first event dedup with per-event tuple fallback"
```

---

### Task 6: Clone remap regenerates event ids (`evt_` prefix)

**Files:**
- Modify: `src/utilities/okfImportRemap.ts:32-39`
- Test: `src/utilities/__tests__/okfImportRemap.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/utilities/__tests__/okfImportRemap.test.ts`:

```typescript
describe('event id regeneration (profile v1)', () => {
  it('regenerates every event id with the evt_ prefix and drops the originals', () => {
    const dump = {
      generatedAt: 0,
      entities: {
        e1: {
          facts: [{ id: 'fact_a' }],
          tasks: [],
          edges: [],
          events: [
            { id: 'evt_original_1', related_entry_id: 'fact_a' },
            { id: 'evt_original_2', related_entry_id: null },
          ],
        },
      },
    } as never
    const result = remapOkfDumpIds(dump, 'e1')
    const events = result.entities.e1.events as Array<{ id: string; related_entry_id: string | null }>
    expect(events.map((e) => e.id)).not.toContain('evt_original_1')
    expect(events.map((e) => e.id)).not.toContain('evt_original_2')
    expect(events.every((e) => e.id.startsWith('evt_'))).toBe(true)
    expect(new Set(events.map((e) => e.id)).size).toBe(2)
    // related_entry_id still remaps through the fact id map
    const newFactId = (result.entities.e1.facts[0] as { id: string }).id
    expect(events[0].related_entry_id).toBe(newFactId)
    expect(events[1].related_entry_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/utilities/__tests__/okfImportRemap.test.ts`
Expected: the new test FAILS — original event ids survive.

- [ ] **Step 3: Implement**

In `src/utilities/okfImportRemap.ts`, replace the `remappedEvents` block (lines 32–39):

```typescript
  const remappedEvents = entity.events.map((event) => {
    // As of OKF profile v1 (core-llm-wiki 4.18+), parseOkfBundle preserves
    // event ids from log.md id comments. A clone beside a still-live source
    // character would collide on the events table's id primary key and be
    // silently dropped by INSERT OR IGNORE — regenerate, matching the
    // package's own evt_ prefix convention.
    const remappedRelatedId = event.related_entry_id
      ? (idMap.get(event.related_entry_id) ?? null)
      : null
    return { ...event, id: `evt_${randomUUID()}`, related_entry_id: remappedRelatedId }
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/utilities/__tests__/okfImportRemap.test.ts`
Expected: PASS, including pre-existing remap tests (their event assertions may need the id shape updated if they pinned old ids — the invariant they should assert is "no source id survives").

- [ ] **Step 5: Fixture regression (the headline test)**

Append to the same test file:

```typescript
import { parseOkfBundle } from '@equationalapplications/expo-llm-wiki'
import { loadOkfFixture } from './okfFixtures'

describe('clone against golden-v1 fixture', () => {
  it('leaves no fixture event id in the remapped dump (clone-beside-source regression)', () => {
    const dump = parseOkfBundle('cloneTarget', loadOkfFixture('golden-v1'))
    const sourceEventIds = dump.entities.cloneTarget.events.map((e) => e.id)
    expect(sourceEventIds).toEqual(expect.arrayContaining(['evt_golden_1', 'evt_golden_2']))
    const remapped = remapOkfDumpIds(dump, 'cloneTarget')
    const remappedIds = remapped.entities.cloneTarget.events.map((e) => e.id)
    expect(remappedIds).not.toEqual(expect.arrayContaining(['evt_golden_1']))
    expect(remappedIds).not.toEqual(expect.arrayContaining(['evt_golden_2']))
    expect(remapped.entities.cloneTarget.events).toHaveLength(sourceEventIds.length)
  })
})
```

Run: `npm run test -- src/utilities/__tests__/okfImportRemap.test.ts`
Expected: PASS. (If jest chokes on importing the real package in this suite, check how `okfImport.test.ts` imports it — follow that pattern; the package is plain TS/JS with no native deps on this path.)

- [ ] **Step 6: Commit**

```bash
git add src/utilities/okfImportRemap.ts src/utilities/__tests__/okfImportRemap.test.ts
git commit -m "fix: regenerate event ids on clone remap — profile v1 preserves them"
```

---

### Task 7: Thread scan + preview enrichment through the hook

**Files:**
- Modify: `src/hooks/useImportCharacterOKF.ts`
- Test: `src/hooks/__tests__/useImportCharacterOKF.test.ts`

- [ ] **Step 1: Update the hook**

In `src/hooks/useImportCharacterOKF.ts`:

Add imports:

```typescript
import { scanExplicitEventIds } from '~/utilities/okfImportDedupe'
import { detectOkfProfile, markdownToPlainSnippet, type OkfProfile } from '~/utilities/okfPreview'
```

Extend the stats interface:

```typescript
export interface OkfPreviewStats {
  facts: number
  tasks: number
  events: number
  edges: number
  profile: OkfProfile
  summarySnippet: string | null
}
```

In `handlePickAndPreview`, replace the `setPreview` call:

```typescript
      setPreview({
        facts: entity?.facts.length ?? 0,
        tasks: entity?.tasks.length ?? 0,
        events: entity?.events.length ?? 0,
        edges: entity?.edges?.length ?? 0,
        profile: detectOkfProfile(files),
        summarySnippet: entity?.summary ? markdownToPlainSnippet(entity.summary) : null,
      })
```

In `handleCommitImport`, replace the dedup line:

```typescript
        } else {
          const explicitEventIds = scanExplicitEventIds(filesRef.current)
          dump = await dedupeEventsAgainstExisting(wiki, targetEntityId, dump, explicitEventIds)
        }
```

(Note: `filesRef.current` is still non-null here — it is captured before the parse and cleared only after success.)

- [ ] **Step 2: Update hook tests**

Run: `npm run test -- src/hooks/__tests__/useImportCharacterOKF.test.ts`
Fix fallout: preview assertions gain `profile`/`summarySnippet` fields (mocked bundles without a root `index.md` yield `profile: 'legacy'`); dedup-mock call assertions gain the fourth `Set` argument. Add one new case:

```typescript
it('marks profile llm-wiki/1 and includes a summary snippet when present', async () => {
  // Arrange the pickAndReadOkfBundle mock to return a bundle whose index.md
  // contains "profile: llm-wiki/1" and whose parse mock returns
  // entities[previewId] with summary: '**Bold** summary'.
  // Assert: preview.profile === 'llm-wiki/1'
  //         preview.summarySnippet === 'Bold summary'
})
```

Fill the arrange section following the file's existing mock structure (it mocks `~/utilities/okfImport` and `@equationalapplications/expo-llm-wiki`).
Expected after edits: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useImportCharacterOKF.ts src/hooks/__tests__/useImportCharacterOKF.test.ts
git commit -m "feat: id-aware dedup wiring and profile/summary preview stats in import hook"
```

---

### Task 8: Preview modal UI (profile badge + summary snippet)

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx` (import preview modal, ~line 719)
- Modify: `app/(drawer)/(tabs)/characters/list.tsx` (clone preview UI — locate with `grep -n "preview" app/\(drawer\)/\(tabs\)/characters/list.tsx`)

- [ ] **Step 1: Edit screen modal**

In `edit.tsx`, inside the `{importPreview ? (<>` block, directly above `<View style={styles.previewCountsContainer}>`:

```tsx
                <Text variant="labelMedium" style={styles.previewProfile}>
                  {importPreview.profile === 'llm-wiki/1'
                    ? 'OKF profile: llm-wiki/1'
                    : 'Legacy bundle (pre-profile)'}
                </Text>
                {importPreview.summarySnippet ? (
                  <View style={styles.previewSummary}>
                    <Text variant="labelMedium">Memory summary included</Text>
                    <Text variant="bodySmall" numberOfLines={3}>
                      {importPreview.summarySnippet}
                    </Text>
                  </View>
                ) : null}
```

Add to the `StyleSheet.create` block (near `previewCountsContainer`, ~line 868):

```typescript
  previewProfile: {
    opacity: 0.7,
    marginBottom: 8,
  },
  previewSummary: {
    marginBottom: 12,
    gap: 2,
  },
```

- [ ] **Step 2: Clone preview in list.tsx**

Locate the clone preview rendering (`grep -n "preview\|facts:" "app/(drawer)/(tabs)/characters/list.tsx"`) and add the same two blocks (profile line + snippet block) with matching style entries in that file's stylesheet. Same JSX as Step 1 — copy it, adjusting only the style-object names if that file uses a different naming pattern.

- [ ] **Step 3: Verify in app**

Run: `npm run typecheck`, then launch (`npx expo start`) and exercise: import the golden-v1 fixture zipped (`cd src/utilities/__tests__/fixtures/golden-v1 && zip -r /tmp/golden.okf.zip .`) into a test character → modal shows "OKF profile: llm-wiki/1" + snippet; zip legacy-profile-0 the same way → "Legacy bundle (pre-profile)", no snippet.

- [ ] **Step 4: Commit**

```bash
git add "app/(drawer)/(tabs)/characters/[id]/edit.tsx" "app/(drawer)/(tabs)/characters/list.tsx"
git commit -m "feat: show OKF profile badge and summary snippet in import previews"
```

---

### Task 9: Read-only "Memory summary" section on the edit screen

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`

- [ ] **Step 1: Implement**

In the edit screen component (near the other hook calls, ~line 90):

```typescript
  const [memorySummary, setMemorySummary] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    wiki
      .getEntitySummary(characterId)
      .then((summary) => {
        if (!cancelled) setMemorySummary(summary)
      })
      .catch(() => {
        /* display-only — a read failure just hides the section */
      })
    return () => {
      cancelled = true
    }
  }, [wiki, characterId, didImport])
```

(`didImport` comes from the already-destructured `useImportCharacterOKF()` — its flip after a successful import refreshes the section. `wiki` — add `const wiki = useWiki()` with the import from `@equationalapplications/expo-llm-wiki` if the screen doesn't already have one; check first.)

Render near the existing import/export buttons (~line 561):

```tsx
        {memorySummary ? (
          <View style={styles.memorySummarySection}>
            <Text variant="titleSmall">Memory summary</Text>
            <Text variant="bodyMedium">{memorySummary}</Text>
          </View>
        ) : null}
```

Style:

```typescript
  memorySummarySection: {
    marginTop: 16,
    gap: 4,
  },
```

- [ ] **Step 2: Verify in app**

Import golden-v1 (merge) into a character → section appears with the fixture's summary prose. Character without a summary → section absent.

- [ ] **Step 3: Commit**

```bash
git add "app/(drawer)/(tabs)/characters/[id]/edit.tsx"
git commit -m "feat: read-only memory summary section on character edit screen"
```

---

### Task 10: Docs refresh

**Files:**
- Modify: `src/constants/okfReadmeContent.ts`
- Modify: `app/support.tsx` (existing OKF FAQ pair)
- Modify: `public/memory-export-with-okf/index.html`

- [ ] **Step 1: Bundle README**

In `src/constants/okfReadmeContent.ts`, add to the generated content (after the existing OKF explanation paragraph):

```text
This bundle conforms to the llm-wiki OKF profile, version 1 (see the root
index.md "profile" key). Timeline entries carry stable ids, so restoring the
same backup twice never duplicates your history, and edge links live in each
entry's "## Related" section. Profile reference:
https://github.com/equationalapplications/expo-llm-wiki/blob/main/docs/okf-profile.md
```

- [ ] **Step 2: FAQ**

In `app/support.tsx`, extend the existing OKF Q&A answer `<Text>` with one sentence:

```text
Restoring the same backup more than once won't duplicate your character's timeline.
```

- [ ] **Step 3: Public page**

In `public/memory-export-with-okf/index.html`, in the "what's in the zip" section, add a short paragraph (match the page's existing tag structure):

```html
<p>
  Exports now follow the versioned <strong>llm-wiki/1</strong> OKF profile:
  relationships are part of the format itself, timeline entries carry stable
  identifiers (repeated restores never duplicate your history), and memory
  summaries from other OKF tools survive a round-trip through Clanker.
</p>
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm run test -- src`

```bash
git add src/constants/okfReadmeContent.ts app/support.tsx public/memory-export-with-okf/index.html
git commit -m "docs: profile v1 notes in bundle README, FAQ, and public OKF page"
```

---

### Task 11: Final verification + spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-07-05-okf-profile-v1-adoption-design.md` (status line)

- [ ] **Step 1: Full CI locally**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green.

- [ ] **Step 2: End-to-end round-trip in the app**

Export a character with edges and events → unzip and confirm: root `index.md` has `profile: llm-wiki/1`; a fact file has exactly **one** `## Related` section; log lines end with `<!-- id: evt_... -->`. Re-import the same zip (merge) twice → event count unchanged after the second import. Clone the zip to a new character while the source still exists → the clone's timeline has the full event count.

- [ ] **Step 3: Flip spec status**

Change `**Status:** Approved` to `**Status:** Implemented` in the spec.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-05-okf-profile-v1-adoption-design.md
git commit -m "docs(specs): mark OKF profile v1 adoption implemented"
```

---

## Spec-coverage map

| Spec section | Tasks |
|---|---|
| §Dependencies (bump both, no core-okf) | 1 |
| §1 export augmentation deletion | 3 |
| §2 id-first dedup + anchoring | 4, 5, 7 |
| §3 clone event-id regen + `evt_` prefix | 6 |
| §4 summary round-trip (inherited) + display | 9 (display), 1 (inheritance), 11 (e2e check) |
| §5 keep safeguards | untouched by design — Task 11 e2e confirms |
| §6 preview UX + docs | 7, 8, 10 |
| §Testing fixtures/checksums | 2; fixture-driven cases in 4–6 |
