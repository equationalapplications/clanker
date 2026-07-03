# OKF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to export character memories (facts, tasks, episodic events, and graph edges) as portable OKF bundles with platform-aware save (web download + mobile file system).

**Architecture:** Compose existing `formatOkfBundle` adapter (from `expo-llm-wiki`) with a thin edge-augmentation pass that injects markdown links into concept files, then zip and platform-save. Web uses blob anchor download; mobile writes to device filesystem and triggers share sheet via `expo-sharing`.

**Tech Stack:** 
- `@equationalapplications/expo-llm-wiki` (existing, re-exports `formatOkfBundle`, `MemoryDump`, `OkfFile`)
- `jszip` (new dependency)
- `expo-file-system` (existing)
- `expo-sharing` (new dependency)

---

## File Structure

**New files to create:**
- `src/hooks/useExportCharacterOKF.ts` — React hook orchestrating dump → format → augment → zip → save
- `src/utils/augmentWithEdgeLinks.ts` — Edge augmentation logic (frontmatter id extraction, relative-link building). Pure data transform, no I/O — belongs in `src/utils/` alongside `audioResample.ts`/`sanitizeGroundingHtml.ts`, not `src/utilities/`.
- `src/utilities/okfSave.ts` — Native (mobile) save: `expo-file-system` write + `expo-sharing` share sheet
- `src/utilities/okfSave.web.ts` — Web save: blob anchor download. Follows this repo's existing platform-split convention (see `kvStorage.ts`/`kvStorage.web.ts`, `checkoutChannel.ts`/`checkoutChannel.web.ts`) rather than a runtime `Platform.OS` branch inside one file.
- `src/constants/okfReadmeContent.ts` — Static README.md text for bundle root
- `src/utils/__tests__/augmentWithEdgeLinks.test.ts` — Unit tests for edge augmentation
- `public/memory-export-with-okf/index.html` — New static explainer page

**Files to modify:**
- `package.json` — Add `jszip` and `expo-sharing` dependencies
- `app/(drawer)/(tabs)/characters/[id]/edit.tsx` — Add "Export Memory as OKF" button. This is the real per-character settings screen (verified: already has cloud-sync/share actions, `toastState` + `Snackbar` pattern, and a `reportError` import — no separate `CharacterSettings.tsx` file exists)
- `src/components/LandingPage/FeaturesSection.tsx` — Add OKF feature card
- `app/support.tsx` — Add FAQ entry about export
- `src/config/privacyConfig.ts` — Add "Data Portability" section
- `scripts/generate-static-pages.js` — Wire new page into sitemap and nav

**Verified against actual repo state (self-review, this pass):**
- Test runner: `npm test -- <path>` (jest via `jest-expo` preset, config in `jest.config.js`) — confirmed working
- Type check: `npm run typecheck` (not `type-check` — no such script exists)
- No generic `npm run build` script exists. Closest equivalents: `npm run typecheck:generate` (expo web export + typecheck) or `npm run predeploy` (`generate:static-pages` + expo web export)
- Error reporting: `~/utilities/reportError` (`reportError(error: unknown, context?: string)`), not `../utils/errorReporting` — confirmed via `tsconfig.json` (`~/*` → `./src/*`) and existing usage in `edit.tsx`
- No `Toast` component exists in this codebase. Existing screens (`edit.tsx`, `profile.tsx`) use react-native-paper's `Snackbar` driven by local `toastState` — use that pattern, not an invented `Toast` import
- `jszip` and `expo-sharing` confirmed NOT in `node_modules` — Task 1 install is required, not optional
- Two utils directories exist: `src/utils/` (small, pure-function helpers) and `src/utilities/` (larger, includes the `.ts`/`.web.ts` platform-split convention) — placement above reflects which one each new file matches

---

## Task 1: Add Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jszip and expo-sharing**

Run: 
```bash
npm install jszip expo-sharing
```

Verify installation:
```bash
npm ls jszip expo-sharing
```

Expected: Both packages appear in the tree.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add jszip and expo-sharing for OKF export"
```

---

## Task 2: Implement Edge Augmentation Utility

**Files:**
- Create: `src/utils/augmentWithEdgeLinks.ts`
- Create: `src/utils/__tests__/augmentWithEdgeLinks.test.ts`

- [ ] **Step 1: Write failing unit tests for edge augmentation**

Create `src/utils/__tests__/augmentWithEdgeLinks.test.ts`:

```typescript
import { augmentWithEdgeLinks } from '../augmentWithEdgeLinks'
import { parseOkfBundle, formatOkfBundle } from '@equationalapplications/expo-llm-wiki'

// expo-llm-wiki doesn't re-export the OkfFile type itself (see
// augmentWithEdgeLinks.ts) — derive it the same way the implementation does.
type OkfFile = ReturnType<typeof formatOkfBundle>['files'][number]

describe('augmentWithEdgeLinks', () => {
  it('extracts ids from concept file frontmatter', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Test"
---
Body text`,
      },
    ]

    const result = augmentWithEdgeLinks(files, [])
    expect(result[0].content).toContain('Body text')
  })

  it('appends same-type links (fact → fact)', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact A"
---
Body A`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Fact B"
---
Body B`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).toContain('## Related')
    expect(augmented?.content).toContain('[related_to](./fact_xyz.md)')
  })

  it('appends cross-type links (fact → task)', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Fact body`,
      },
      {
        path: 'entities/char_1/tasks/task_xyz.md',
        content: `---
type: task
id: task_xyz
title: "Task"
---`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'task_xyz',
        edge_type: 'prerequisite_for',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).toContain('[prerequisite_for](../tasks/task_xyz.md)')
  })

  it('skips dangling edges (target not in bundle)', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Body`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'missing_target',
        edge_type: 'links_to',
        created_at: 1234567890,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).not.toContain('## Related')
  })

  it('handles multiple outgoing edges from same source', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Body`,
      },
      {
        path: 'entities/char_1/facts/fact_1.md',
        content: `---
type: fact
id: fact_1
title: "Related 1"
---`,
      },
      {
        path: 'entities/char_1/facts/fact_2.md',
        content: `---
type: fact
id: fact_2
title: "Related 2"
---`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_1',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
      {
        id: 'edge_2',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_2',
        edge_type: 'related_to',
        created_at: 1234567891,
      },
    ]

    const result = augmentWithEdgeLinks(files, edges)
    const augmented = result.find((f) => f.path.includes('fact_abc.md'))
    expect(augmented?.content).toContain('[related_to](./fact_1.md)')
    expect(augmented?.content).toContain('[related_to](./fact_2.md)')
  })

  it('does not duplicate "## Related" section on multiple calls', () => {
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact"
---
Body`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Target"
---`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const firstPass = augmentWithEdgeLinks(files, edges)
    const secondPass = augmentWithEdgeLinks(firstPass, edges)

    const countRelated = (content: string) => (content.match(/## Related/g) || []).length
    expect(countRelated(secondPass[0].content)).toBe(1)
  })

  it('round-trips through parseOkfBundle: augmented links reconstruct as edges', () => {
    // This is the actual claim the spec makes ("round-trip-safe graph edges") —
    // asserting on the appended markdown string isn't enough, since a formatting
    // change to extractMarkdownLinks's regex could still break real re-import
    // while every string-contains assertion above kept passing.
    const files: OkfFile[] = [
      {
        path: 'entities/char_1/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact A"
---
Body A`,
      },
      {
        path: 'entities/char_1/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Fact B"
---
Body B`,
      },
    ]

    const edges = [
      {
        id: 'edge_1',
        entity_id: 'char_1',
        source_id: 'fact_abc',
        target_id: 'fact_xyz',
        edge_type: 'related_to',
        created_at: 1234567890,
      },
    ]

    const augmented = augmentWithEdgeLinks(files, edges)
    const reparsed = parseOkfBundle('char_1', augmented)

    expect(reparsed.edges).toHaveLength(1)
    expect(reparsed.edges[0]).toMatchObject({
      source_id: 'fact_abc',
      target_id: 'fact_xyz',
      edge_type: 'related_to',
    })
    // Note: parseOkfBundle regenerates `id` and `created_at` on reconstructed
    // edges (see spec's "Round-trip fidelity" note) — only source/target/type
    // survive the round trip, so we don't assert on those two fields.
  })
})
```

- [ ] **Step 2: Run tests to verify they all fail**

```bash
npm test -- src/utils/__tests__/augmentWithEdgeLinks.test.ts
```

Expected: All tests FAIL with "augmentWithEdgeLinks is not exported".

- [ ] **Step 3: Write minimal augmentation implementation**

Create `src/utils/augmentWithEdgeLinks.ts`:

```typescript
import type { WikiEdge } from '@equationalapplications/expo-llm-wiki'
import { formatOkfBundle } from '@equationalapplications/expo-llm-wiki'

// formatOkfBundle's own return type — core-llm-wiki imports OkfFile from
// core-okf internally but doesn't re-export the type itself, and we don't
// take a direct core-okf dependency (see spec's Dependencies section).
type OkfFile = ReturnType<typeof formatOkfBundle>['files'][number]

function isConceptFile(path: string): boolean {
  if (!path.endsWith('.md')) return false
  if (path === 'index.md' || path.endsWith('/index.md')) return false
  if (path === 'log.md' || path.endsWith('/log.md')) return false
  return true
}

export function augmentWithEdgeLinks(files: OkfFile[], edges: WikiEdge[]): OkfFile[] {
  if (edges.length === 0) {
    return files
  }

  // Map file path to its id extracted from frontmatter
  const pathToId = new Map<string, string>()
  const idToPath = new Map<string, string>()
  const idToType = new Map<string, 'facts' | 'tasks'>() // track if fact or task

  // Extract ids from frontmatter. No `m` flag and an anchored `^---\n` start —
  // a bare `m`-flag match against the whole file can false-hit a `---`
  // thematic break inside a fact body (e.g. a markdown hr), which would
  // misattribute that file's id. Restricted to concept files (not
  // index.md/log.md) since those have no `id:` frontmatter field to extract.
  const frontmatterIdRegex = /^---\n([\s\S]*?)\nid:\s*(\S+)/

  for (const file of files) {
    if (!isConceptFile(file.path)) continue
    if (!file.content.startsWith('---\n')) continue
    const match = file.content.match(frontmatterIdRegex)
    if (match && match[2]) {
      const id = match[2]
      pathToId.set(file.path, id)
      idToPath.set(id, file.path)

      // Determine type from path
      if (file.path.includes('/facts/')) {
        idToType.set(id, 'facts')
      } else if (file.path.includes('/tasks/')) {
        idToType.set(id, 'tasks')
      }
    }
  }

  // Build a map of source_id → [edges]
  const edgesBySource = new Map<string, WikiEdge[]>()
  for (const edge of edges) {
    if (!edgesBySource.has(edge.source_id)) {
      edgesBySource.set(edge.source_id, [])
    }
    edgesBySource.get(edge.source_id)!.push(edge)
  }

  // Augment files
  const augmented: OkfFile[] = []

  for (const file of files) {
    const sourceId = pathToId.get(file.path)
    const relatedEdges = sourceId ? edgesBySource.get(sourceId) || [] : []

    if (relatedEdges.length === 0) {
      augmented.push(file)
      continue
    }

    // Guard against double-augmentation using a dedicated marker, not a bare
    // "## Related" text search — a fact body could legitimately contain that
    // heading itself, which would silently swallow real edges.
    const alreadyAugmented = file.content.includes('<!-- okf-edges-augmented -->')
    if (alreadyAugmented) {
      augmented.push(file)
      continue
    }

    // Build links
    const links: string[] = []

    for (const edge of relatedEdges) {
      const targetPath = idToPath.get(edge.target_id)
      if (!targetPath) {
        // Dangling edge — skip and log
        console.warn(
          `Dangling edge: source_id=${edge.source_id} target_id=${edge.target_id}`,
        )
        continue
      }

      const sourceType = idToType.get(sourceId!)
      const targetType = idToType.get(edge.target_id)

      let relativeLink: string

      if (sourceType === targetType) {
        // Same type: both facts or both tasks
        const targetFilename = targetPath.split('/').pop()!
        relativeLink = `./${targetFilename}`
      } else {
        // Cross-type (fact ↔ task) — always one level up, since this branch
        // only runs when sourceType !== targetType
        const targetFilename = targetPath.split('/').pop()!
        relativeLink = `../${targetType}/${targetFilename}`
      }

      links.push(`- [${edge.edge_type}](${relativeLink})`)
    }

    if (links.length === 0) {
      augmented.push(file)
      continue
    }

    // Append "## Related" section, tagged with a marker so a second pass
    // over the same file (e.g. re-running export) doesn't re-scan and skip.
    const relatedSection = `\n<!-- okf-edges-augmented -->\n## Related\n\n${links.join('\n')}`
    const augmentedContent = file.content + relatedSection

    augmented.push({
      ...file,
      content: augmentedContent,
    })
  }

  return augmented
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/utils/__tests__/augmentWithEdgeLinks.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/augmentWithEdgeLinks.ts src/utils/__tests__/augmentWithEdgeLinks.test.ts
git commit -m "feat: implement edge augmentation for OKF export"
```

---

## Task 3: Implement Platform-Aware Save Utility

**Files:**
- Create: `src/utilities/okfSave.ts` (native/mobile)
- Create: `src/utilities/okfSave.web.ts` (web)

This repo resolves platform-specific modules via Metro/webpack's `.web.ts` suffix convention (see `kvStorage.ts`/`kvStorage.web.ts`, `checkoutChannel.ts`/`checkoutChannel.web.ts` in `src/utilities/`) — both files export the same function signature, and the bundler picks the right one per platform. No runtime `Platform.OS` check needed in the calling code.

- [ ] **Step 1: Write the shared ZIP-building helper + native save**

Create `src/utilities/okfSave.ts`:

**Important:** the installed `expo-file-system` version is `~56.0.8` — the v56 rewrite. The root package export (`import * as FileSystem from 'expo-file-system'`) now only contains **deprecated stubs** for `writeAsStringAsync`/`cacheDirectory`/etc. that *typecheck* but **throw at runtime** ("Method writeAsStringAsync imported from expo-file-system is deprecated ... This method will throw in runtime."). Use the new `File`/`Paths` class API instead — this repo already does, in `src/hooks/useAvatarUpload.ts` (`import { File } from 'expo-file-system'`).

```typescript
import JSZip from 'jszip'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

export interface ZipOptions {
  characterName: string
  files: Array<{ path: string; content: string }>
}

function buildZipFilename(characterName: string): string {
  const dateStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  // Strip path separators and other filesystem-hostile chars — characterName
  // is user-controlled and flows straight into a native file path below.
  const safeName = characterName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'character'
  return `${safeName}_${dateStr}.okf.zip`
}

/**
 * Save OKF bundle as ZIP (native/mobile).
 * Writes to app cache dir via the expo-file-system File/Paths API, then opens
 * the share sheet via expo-sharing.
 */
export async function zipAndSaveOKF(options: ZipOptions): Promise<void> {
  const { characterName, files } = options
  const zipFilename = buildZipFilename(characterName)

  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.path, file.content)
  }

  const bytes = await zip.generateAsync({ type: 'uint8array' })

  const file = new File(Paths.cache, zipFilename)
  file.write(bytes)

  const canShare = await Sharing.isAvailableAsync()
  if (!canShare) {
    throw new Error('Sharing is not available on this device')
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/zip',
    dialogTitle: `Share ${zipFilename}`,
  })
}
```

- [ ] **Step 2: Write the web save variant**

Create `src/utilities/okfSave.web.ts`:

```typescript
import JSZip from 'jszip'

export interface ZipOptions {
  characterName: string
  files: Array<{ path: string; content: string }>
}

function buildZipFilename(characterName: string): string {
  const dateStr = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  // Strip chars that are invalid/awkward in a downloaded filename across OSes.
  const safeName = characterName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'character'
  return `${safeName}_${dateStr}.okf.zip`
}

/**
 * Save OKF bundle as ZIP (web).
 * Triggers a standard blob-anchor download.
 */
export async function zipAndSaveOKF(options: ZipOptions): Promise<void> {
  const { characterName, files } = options
  const zipFilename = buildZipFilename(characterName)

  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.path, file.content)
  }

  const blob = await zip.generateAsync({ type: 'blob' })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = zipFilename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 3: Verify no import errors**

Run:
```bash
npm run typecheck
```

Expected: No TypeScript errors in either `okfSave.ts` or `okfSave.web.ts`. Note: typecheck alone does NOT catch the legacy-API runtime-throw issue described above — the deprecated `FileSystem.writeAsStringAsync` signature still typechecks, it just throws when actually called. That's why this step says "no import errors," not "verified working" — Task 14's manual mobile test is what actually exercises the write path.

- [ ] **Step 4: Commit**

```bash
git add src/utilities/okfSave.ts src/utilities/okfSave.web.ts
git commit -m "feat: implement platform-aware OKF save (web blob + mobile filesystem)"
```

---

## Task 4: Implement OKF README Content

**Files:**
- Create: `src/constants/okfReadmeContent.ts`

- [ ] **Step 1: Write README constant**

Create `src/constants/okfReadmeContent.ts`:

Note: this must be a function, not a module-level `const`. A `const` evaluates
`new Date()` once at module load (app launch), so every export in that session
would ship the same stale "Generated:" timestamp regardless of when the user
actually clicked export.

```typescript
export function buildOkfReadmeContent(): string {
  return `# Open Knowledge Format (OKF) Export

## What's Inside

This ZIP contains your character's complete memory export, including:

- **Facts** — everything your character knows or has learned
- **Tasks** — goals and actions your character is tracking
- **Timeline** — chronological log of events and interactions
- **Connections** — explicit links showing how facts and tasks relate to each other

## File Layout

\`\`\`
├── index.md                    # Overview of exported entities
├── README.md                   # This file
└── entities/
    └── {character-name}/
        ├── index.md            # Character's fact and task catalog
        ├── log.md              # Chronological event timeline
        ├── facts/
        │   ├── {id}.md         # Individual facts with metadata
        │   └── ...
        └── tasks/
            ├── {id}.md         # Individual tasks with metadata
            └── ...
\`\`\`

## How to Use This Export

### 1. View Locally

Unzip this file and open it in any markdown viewer:

- **Obsidian** (free, recommended for graph visualization)
- **VS Code** with markdown preview
- **Apple Notes** or any standard markdown reader
- **GitHub** or GitLab (upload the contents of \`entities/\`)

### 2. Back It Up

Store this ZIP in your preferred cloud storage or external drive as a complete backup of your character's knowledge.

### 3. Share or Migrate

If you use other OKF-compatible tools, import this ZIP into them. The standard format ensures interoperability.

### 4. Future Re-import

You can re-import this bundle back into Clanker in a future version via the character settings (not yet wired to the UI, but the technical capability already exists).

## What's Not Included (V1)

This export focuses on your character's memories and how they connect:

- **Ontology/Taxonomy Rules** — If your character has ontology rules defined, they are not included in this version. (Coming in V2.)
- **Training/Fine-tuning Data** — This is a knowledge snapshot, not model weights.

## Privacy

This export is generated entirely on your device, offline. It is never uploaded unless you choose to do so. Your data is yours to keep, share, or delete.

## Need Help?

For more details on OKF and this export feature, visit:
https://equationalapplications.com/memory-export-with-okf

---

Generated: ${new Date().toISOString()}
`.trim()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/constants/okfReadmeContent.ts
git commit -m "feat: add OKF README template for export bundles"
```

---

## Task 5: Implement useExportCharacterOKF Hook

**Files:**
- Create: `src/hooks/useExportCharacterOKF.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useExportCharacterOKF.ts`:

```typescript
import { useCallback, useState } from 'react'
import { useWiki, formatOkfBundle } from '@equationalapplications/expo-llm-wiki'
import { augmentWithEdgeLinks } from '~/utils/augmentWithEdgeLinks'
import { zipAndSaveOKF } from '~/utilities/okfSave'
import { buildOkfReadmeContent } from '~/constants/okfReadmeContent'
import { reportError } from '~/utilities/reportError'

// formatOkfBundle's own return type — core-llm-wiki doesn't re-export OkfFile
// itself (see augmentWithEdgeLinks.ts), and we don't take a direct core-okf
// dependency, so derive the file shape from the function that produces it.
type OkfFile = ReturnType<typeof formatOkfBundle>['files'][number]

interface ExportResult {
  isEmpty: boolean
}

export function useExportCharacterOKF(characterId: string, characterName: string) {
  const wiki = useWiki()
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [lastResult, setLastResult] = useState<ExportResult | null>(null)

  const exportOkf = useCallback(async () => {
    setIsExporting(true)
    setError(null)

    try {
      // Fetch memory dump
      const dump = await wiki.exportDump([characterId])
      const entity = dump.entities[characterId]

      // isEmpty drives the "Empty bundle exported..." toast — this is a
      // successful export, not an error, so it can't be signaled via `error`.
      const isEmpty =
        !entity || (entity.facts.length === 0 && entity.tasks.length === 0 && entity.events.length === 0)

      // Format into OKF structure
      const { files } = formatOkfBundle(dump)

      // Augment with edge links
      const edges = entity?.edges ?? []
      const augmented = augmentWithEdgeLinks(files, edges)

      // Add README (built fresh per export so the "Generated:" timestamp is accurate)
      const withReadme: OkfFile[] = [
        ...augmented,
        { path: 'README.md', content: buildOkfReadmeContent() },
      ]

      // Zip and save
      await zipAndSaveOKF({
        characterName,
        files: withReadme,
      })

      // Set after save succeeds — this is what the UI uses to distinguish
      // "export just succeeded" from "no export has run yet" (both leave
      // `error` at null, so `error === null` alone can't drive a success toast).
      setLastResult({ isEmpty })
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err))
      setError(normalized)
      reportError(normalized, `okf-export:${characterId}`)
    } finally {
      setIsExporting(false)
    }
  }, [wiki, characterId, characterName])

  return { exportOkf, isExporting, error, lastResult }
}
```

- [ ] **Step 2: Verify types**

```bash
npm run typecheck
```

Expected: No TypeScript errors in the hook.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useExportCharacterOKF.ts
git commit -m "feat: add useExportCharacterOKF hook for orchestrating OKF export"
```

---

## Task 6: Add "Export Memory as OKF" Button to Character Edit Screen

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`

This screen is the real per-character settings surface (confirmed by reading the file): it already has `characterId` (line 35, from `useLocalSearchParams`), a `name` state var (line 51), a `toastState`/`Snackbar` pattern (lines 63-65, 589-596) for user-facing messages, `reportError` already imported (line 25), and a "Sync Memory" button (lines 505-516) that's the closest existing analog — same `react-native-paper` `Button` component, same conditional-render-on-cloud-sync-state pattern, right next to where this new button belongs.

- [ ] **Step 1: Add hook import**

At the top of `app/(drawer)/(tabs)/characters/[id]/edit.tsx`, alongside the existing `~/hooks/*` imports (near line 31):

```typescript
import { useExportCharacterOKF } from '~/hooks/useExportCharacterOKF'
```

- [ ] **Step 2: Wire up the hook inside the component**

Inside `EditCharacterScreen`, near the other hook calls (after line 49's `useCharacterWiki` call):

```typescript
const {
  exportOkf,
  isExporting,
  error: exportError,
  lastResult: exportResult,
} = useExportCharacterOKF(characterId, name || character?.name || 'character')
```

- [ ] **Step 3: Surface export errors and results via the existing toast state**

`toastState` here is `{ message: string; requiresSubscription: boolean } | null` and is rendered by a `Snackbar` with `action={undefined}` (see file bottom) — there is currently no retry affordance on any toast in this screen. The spec calls for "error toast with retry option," so this task also extends `toastState` with an optional `onRetry` and wires it into the `Snackbar`'s `action` prop.

Add a `useEffect` near the other effects in the file to push `exportError`/`exportResult` into the existing `toastState` mechanism (reusing the pattern already used for `updateError`/`unsyncError`/`cloudSyncError`):

```typescript
useEffect(() => {
  if (exportError) {
    setToastState({
      message: `Export failed: ${exportError.message}`,
      requiresSubscription: false,
      onRetry: exportOkf,
    })
  }
}, [exportError])

useEffect(() => {
  if (exportResult) {
    setToastState({
      message: exportResult.isEmpty
        ? 'Empty bundle exported. Add memories to enrich future exports.'
        : 'Memory exported.',
      requiresSubscription: false,
    })
  }
}, [exportResult])
```

Extend the `toastState` type (declared near line 63) to add the optional retry field:

```typescript
const [toastState, setToastState] = useState<{
  message: string
  requiresSubscription: boolean
  onRetry?: () => void
} | null>(null)
```

And wire it into the `Snackbar` at the bottom of the file (currently `action={undefined}`):

```tsx
<Snackbar
  visible={toastState !== null}
  onDismiss={() => setToastState(null)}
  duration={4000}
  action={
    toastState?.onRetry
      ? { label: 'Retry', onPress: toastState.onRetry }
      : undefined
  }
>
  {toastState?.message}
</Snackbar>
```

- [ ] **Step 4: Add the button next to "Sync Memory"**

Immediately after the "Sync Memory" button block (lines 505-516), add:

```tsx
<Button
  mode="outlined"
  icon="export-variant"
  onPress={exportOkf}
  disabled={isExporting}
  loading={isExporting}
  style={styles.shareButton}
>
  Export Memory as OKF
</Button>
```

(Reuses `styles.shareButton` — the same style already applied to "Share Character" and "Sync Memory" above it, so no new stylesheet entry is needed.)

- [ ] **Step 5: Verify types**

```bash
npm run typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(drawer)/(tabs)/characters/[id]/edit.tsx"
git commit -m "feat: add Export Memory as OKF button to character edit screen"
```

---

## Task 7: Update Landing Page Features Section

**Files:**
- Modify: `src/components/LandingPage/FeaturesSection.tsx`

- [ ] **Step 1: Read existing FeaturesSection to understand structure**

```bash
head -50 src/components/LandingPage/FeaturesSection.tsx
```

- [ ] **Step 2: Add OKF export feature card to FEATURES array**

Locate the `FEATURES` array in `FeaturesSection.tsx` and add this entry:

```typescript
{
  icon: 'export-variant' as const,
  title: 'Own Your Data',
  body: 'Export any character\'s complete memory — facts, tasks, and history — as an open, standard format (OKF). No walled garden. Your data works with any OKF-compatible tool.',
  learnMoreHref: '/memory-export-with-okf',
  isNew: true,
}
```

(If your codebase uses a different icon system or structure, adapt as needed.)

- [ ] **Step 3: Verify no errors**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/components/LandingPage/FeaturesSection.tsx
git commit -m "feat(landing): add OKF export feature card"
```

---

## Task 8: Create Static Explainer Page

**Files:**
- Create: `public/memory-export-with-okf/index.html`

- [ ] **Step 1: Write static HTML explainer page**

Create `public/memory-export-with-okf/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Memory Export with OKF — Equational Applications</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
      background: #fafafa;
    }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.8rem; margin-top: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #666; font-size: 1.1rem; margin-bottom: 2rem; }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
    ul { margin: 1rem 0; }
    li { margin: 0.5rem 0; }
    .highlight {
      background: #fffacd;
      padding: 20px;
      border-left: 4px solid #ffd700;
      margin: 2rem 0;
      border-radius: 4px;
    }
    a { color: #007aff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Export Your Character's Memory with OKF</h1>
  <p class="subtitle">
    Own your data. Your character's memories are yours to keep, backup, and share.
  </p>

  <h2>What is OKF?</h2>
  <p>
    OKF stands for <strong>Open Knowledge Format</strong>. It's an open standard for
    representing structured knowledge — facts, relationships, and events — in a
    portable, human-readable format.
  </p>

  <!-- TODO before merge: link to the real OKF spec URL (npm package readme for
       @equationalapplications/core-okf, or wherever the format is documented) —
       `https://example.com/okf-spec` is a placeholder and must not ship. -->

  <h2>What Can You Export?</h2>
  <p>When you export a character's memory as OKF, you get a ZIP file containing:</p>
  <ul>
    <li><strong>Facts</strong> — everything your character knows</li>
    <li><strong>Tasks</strong> — goals and tracked actions</li>
    <li><strong>Episodic Timeline</strong> — chronological log of events and interactions</li>
    <li><strong>Connections</strong> — explicit links showing how facts and tasks relate</li>
  </ul>

  <div class="highlight">
    <strong>Note:</strong> Ontology/taxonomy rules are not included in V1. They'll be
    added in a future update when ontology editing is available.
  </div>

  <h2>How to Export</h2>
  <ol>
    <li>Open a character's settings</li>
    <li>Scroll to "Data Management"</li>
    <li>Tap <strong>"Export Memory as OKF"</strong></li>
    <li>Choose where to save the ZIP file</li>
  </ol>

  <h2>What to Do With Your Export</h2>

  <h3>View Locally</h3>
  <p>
    Unzip and open in any markdown viewer:
  </p>
  <ul>
    <li><strong>Obsidian</strong> (free, best for graph visualization)</li>
    <li><strong>VS Code</strong> with markdown preview</li>
    <li><strong>Apple Notes</strong> or standard markdown apps</li>
    <li><strong>GitHub/GitLab</strong> (upload the files)</li>
  </ul>

  <h3>Back It Up</h3>
  <p>
    Store the ZIP in your cloud storage (Drive, iCloud, S3) or external drive as a
    complete knowledge backup.
  </p>

  <h3>Use With Other Tools</h3>
  <p>
    If you use other OKF-compatible tools, import this ZIP into them. The standard
    format ensures your data moves freely.
  </p>

  <h3>Re-import Later</h3>
  <p>
    In a future Clanker update, you'll be able to restore a character from an OKF
    export. The technical capability already exists; UI wiring is coming soon.
  </p>

  <h2>Privacy</h2>
  <p>
    Your export is generated entirely on your device, offline. It is never uploaded
    unless you explicitly choose to do so. Your data stays under your control.
  </p>

  <h2>Questions?</h2>
  <p>
    See our <a href="/support">FAQ</a> for more details on data export and privacy.
  </p>
</body>
</html>
```

- [ ] **Step 2: Verify file exists and is readable**

```bash
cat public/memory-export-with-okf/index.html | head -10
```

- [ ] **Step 3: Commit**

```bash
git add public/memory-export-with-okf/index.html
git commit -m "feat: add OKF export explainer page"
```

---

## Task 9: Add FAQ Entry to Support Page

**Files:**
- Modify: `app/support.tsx` (or equivalent FAQ file)

- [ ] **Step 1: Locate FAQ structure**

**Verified against the real file:** `app/support.tsx` is a React Native screen (`import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native'`), not a web page — there is no `{question, answer}` array to append to. The FAQ is a single `Card` (`mode="contained"`) containing 8 hand-written pairs of `<Text variant="titleSmall" style={styles.question}>` (the question) followed by a `<Text>` (the answer). Outbound links elsewhere in the file go through `Linking.openURL(...)`, not `<a href>` — a raw anchor tag has no meaning on native and won't render there.

```bash
grep -n "titleSmall\|Linking.openURL" app/support.tsx
```

- [ ] **Step 2: Add OKF export FAQ entry**

**Verified:** this file has no `theme`/`useTheme` import and no existing inline-colored-text-as-link pattern — its only interactive affordance is `onPressEmail` (lines 7-17), a `Button` whose handler branches on `Platform.OS` (`window.location.assign` on web to stay in the same tab, `Linking.openURL` elsewhere). Match that pattern rather than inventing a new inline-link style.

Add a platform-aware handler near `onPressEmail`:

```typescript
const onPressExportGuide = async () => {
  const url = 'https://equationalapplications.com/memory-export-with-okf'

  if (Platform.OS === 'web') {
    window.location.assign(url)
    return
  }

  await Linking.openURL(url)
}
```

Then, inside the same FAQ `Card.Content`, after the last existing question/answer pair, add a 9th pair following the exact pattern of its neighbors, plus a `Button` for the guide link (matching the "Email Support" button's shape):

```tsx
<Text variant="titleSmall" style={styles.question}>
  Can I export my character's memory?
</Text>
<Text variant="bodyMedium" style={styles.bodyText}>
  Yes — open Character Settings and tap "Export Memory as OKF" to download a
  complete, standard-format backup of everything your character knows,
  including its facts, tasks, and how they connect.
</Text>
<Button mode="text" onPress={onPressExportGuide} icon="open-in-new">
  Data export guide
</Button>
```

Note the link target is an **absolute** URL (`https://equationalapplications.com/memory-export-with-okf`), not a bare `/memory-export-with-okf` path — both `window.location.assign` and `Linking.openURL` need a full URL, not an app-internal route.

- [ ] **Step 3: Verify TypeScript**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/support.tsx
git commit -m "feat(faq): add entry about memory export with OKF"
```

---

## Task 10: Update Privacy Policy

**Files:**
- Modify: `src/config/privacyConfig.ts`

- [ ] **Step 1: Read current privacy policy structure**

```bash
head -120 src/config/privacyConfig.ts
```

- [ ] **Step 2: Add Data Portability section**

Locate the `PRIVACY.privacy` field (around line 111, near "Data Deletion") and add:

```typescript
// ... existing deletion section ...

Data Portability
You can export your character's complete memory (facts, tasks, and interaction
history, including how they relate to each other) at any time from Character
Settings, in the Open Knowledge Format (OKF), an open standard. This self-serve
export contains everything associated with that character's memory. You retain
full control of your exported data.
```

- [ ] **Step 3: Bump privacy version and update timestamp**

In `privacyConfig.ts`, change:

```typescript
version: '1.5' // change to '1.6'
lastUpdated: 'previous-date' // change to new date (e.g., '2026-07-03')
```

- [ ] **Step 4: Verify no errors**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/config/privacyConfig.ts
git commit -m "docs(privacy): add Data Portability section for OKF export"
```

---

## Task 11: Wire OKF Page into Sitemap and Nav

**Files:**
- Modify: `scripts/generate-static-pages.js`

- [ ] **Step 1: Read the script to understand structure**

```bash
grep -A 5 -B 5 "priority:" scripts/generate-static-pages.js | head -30
```

- [ ] **Step 2: Add OKF page to pages array**

Locate the `pages` array in the script (around line 311) and add:

```javascript
{ loc: '/memory-export-with-okf', priority: '0.6' }
```

- [ ] **Step 3: Add footer nav link**

Locate the footer nav links section (around line 210-212) and add alongside `/welcome` and `/real-time-voice`:

```javascript
<a href="/memory-export-with-okf">Memory Export</a>
```

(Adjust formatting to match existing link structure.)

- [ ] **Step 4: Verify script runs without error**

```bash
node scripts/generate-static-pages.js
```

Expected: No errors; `public/sitemap.xml` is updated.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-static-pages.js
git commit -m "feat: wire OKF export page into sitemap and nav"
```

---

## Task 12: Integration Test (Full Flow)

**Files:**
- Create: `src/hooks/__tests__/useExportCharacterOKF.integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `src/hooks/__tests__/useExportCharacterOKF.integration.test.ts`:

```typescript
import { renderHook, act, waitFor } from '@testing-library/react-native'
import { useExportCharacterOKF } from '../useExportCharacterOKF'
import * as okfSave from '~/utilities/okfSave'

// `~/` resolves via babel-plugin-module-resolver (babel.config.js), which
// babel-jest also applies, so jest.mock() below targets the same module
// specifier the hook itself imports — no relative-path drift between the two.

// Mock dependencies
jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useWiki: () => ({
    exportDump: jest.fn().mockResolvedValue({
      generatedAt: '2026-07-03T12:00:00Z',
      entities: {
        char_123: {
          // facts/tasks/events must be present (even if some are empty) —
          // the hook's isEmpty check reads .length off each of them.
          facts: [
            { id: 'fact_abc', title: 'Fact A' },
            { id: 'fact_xyz', title: 'Fact B' },
          ],
          tasks: [],
          events: [],
          edges: [
            {
              id: 'edge_1',
              entity_id: 'char_123',
              source_id: 'fact_abc',
              target_id: 'fact_xyz',
              edge_type: 'related_to',
              created_at: 1234567890,
            },
          ],
        },
      },
    }),
  }),
  formatOkfBundle: jest.fn().mockReturnValue({
    files: [
      {
        path: 'index.md',
        content: '# Root Index\n\nEntities: char_123',
      },
      {
        path: 'entities/char_123/facts/fact_abc.md',
        content: `---
type: fact
id: fact_abc
title: "Fact A"
---
Body A`,
      },
      {
        path: 'entities/char_123/facts/fact_xyz.md',
        content: `---
type: fact
id: fact_xyz
title: "Fact B"
---
Body B`,
      },
    ],
  }),
}))

jest.mock('~/utilities/okfSave')

describe('useExportCharacterOKF', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('exports character memory and saves ZIP', async () => {
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    expect(result.current.isExporting).toBe(false)
    expect(result.current.error).toBeNull()

    await act(async () => {
      await result.current.exportOkf()
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(false)
    })

    expect(okfSave.zipAndSaveOKF).toHaveBeenCalledWith(
      expect.objectContaining({
        characterName: 'TestChar',
        files: expect.arrayContaining([
          expect.objectContaining({
            path: 'index.md',
          }),
          expect.objectContaining({
            path: 'README.md',
          }),
        ]),
      }),
    )
  })

  it('augments files with edge links before zipping', async () => {
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    await act(async () => {
      await result.current.exportOkf()
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(false)
    })

    // Verify augmented file contains edge link
    const callArgs = (okfSave.zipAndSaveOKF as jest.Mock).mock.calls[0][0]
    const factFile = callArgs.files.find((f: any) =>
      f.path.includes('fact_abc.md'),
    )
    expect(factFile.content).toContain('## Related')
    expect(factFile.content).toContain('[related_to]')
  })

  it('handles export errors and sets error state', async () => {
    const { result } = renderHook(() =>
      useExportCharacterOKF('char_123', 'TestChar'),
    )

    // Mock error
    ;(okfSave.zipAndSaveOKF as jest.Mock).mockRejectedValueOnce(
      new Error('ZIP generation failed'),
    )

    await act(async () => {
      await result.current.exportOkf()
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(false)
    })

    expect(result.current.error).not.toBeNull()
    expect(result.current.error?.message).toContain('ZIP generation failed')
  })
})
```

- [ ] **Step 2: Run integration test**

```bash
npm test -- src/hooks/__tests__/useExportCharacterOKF.integration.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/__tests__/useExportCharacterOKF.integration.test.ts
git commit -m "test: add integration test for OKF export flow"
```

---

## Task 13: Manual Testing (Web Platform)

**Files:**
- None (manual testing)

- [ ] **Step 1: Start dev server**

```bash
npm run web
```

Wait for server to start. (No `dev` script exists in this repo — `web` is the correct script, confirmed against `package.json`.)

- [ ] **Step 2: Navigate to character settings**

In the browser, open the app and navigate to a character's settings page. Scroll to "Data Management" section.

- [ ] **Step 3: Verify button appears**

Confirm "Export Memory as OKF" button is visible and enabled.

- [ ] **Step 4: Click export button**

Click the button. Verify:
- Loading spinner appears
- Spinner disappears after a few seconds
- Snackbar success message appears (or file download is triggered in browser)

- [ ] **Step 5: Verify ZIP file**

Download should trigger (check browser's download folder):
- Filename format: `{CharacterName}_{YYYY-MM-DD}.okf.zip`
- Example: `Alice_2026-07-03.okf.zip`

Unzip the file locally and verify structure:

```bash
unzip "Alice_2026-07-03.okf.zip"
ls -la
# Expected:
# index.md
# README.md
# entities/
#   └── {sanitized-character-id}/   # the entity/character id, not the display name — e.g. char_abc123, not "alice"
#       ├── index.md
#       ├── log.md
#       ├── facts/
#       └── tasks/
```

- [ ] **Step 6: Verify README content**

Open `README.md` and confirm it contains:
- "Open Knowledge Format (OKF) Export" heading
- "What's Inside" section
- "How to Use This Export" section
- Instructions for viewing, backing up, sharing

- [ ] **Step 7: Verify edges are augmented**

Open a fact file (e.g., `entities/{character-id}/facts/fact_abc.md` — the directory is the character's id, not its display name) and confirm:
- Frontmatter with `id:` field
- Body text
- "## Related" section with markdown links (if edges exist for that fact)

Example:
```markdown
---
type: fact
id: fact_abc123
title: "Prefers coffee"
---

User mentioned they prefer coffee.

## Related

- [prerequisite_for](../tasks/task_ghi789.md)
```

- [ ] **Step 8: Test empty character (no memories)**

If possible, test export on a character with no facts/tasks/events. Verify:
- Export completes successfully
- ZIP structure is still valid (empty `facts/` and `tasks/` dirs)
- Snackbar message: "Empty bundle exported..."

- [ ] **Step 9: Test error case (simulate failure)**

(Optional: requires code modification to inject mock error)

Temporarily modify hook to throw an error, re-run export, verify:
- Error toast appears with message
- "Retry" button is clickable

Revert the error injection.

---

## Task 14: Manual Testing (Mobile Platform, if applicable)

**Files:**
- None (manual testing)

- [ ] **Step 1: Build and run mobile app**

```bash
npm run android  # or ios
```

Wait for app to load on simulator/device.

- [ ] **Step 2: Navigate to character settings**

Open app, go to character settings, scroll to "Data Management".

- [ ] **Step 3: Click export button**

Tap "Export Memory as OKF". Verify:
- Loading spinner appears
- Spinner disappears after a few seconds
- Share sheet opens (iOS) or file manager appears (Android)

- [ ] **Step 4: Complete share flow**

On iOS: Choose "Save to Files" or "Message" or other share target.
On Android: Choose file manager destination or other app.

- [ ] **Step 5: Verify file was saved**

Navigate to the saved file location and open the ZIP. Verify structure matches web test (Task 13, Step 7).

- [ ] **Step 6: Test offline export**

Disconnect device from network, repeat export. Verify it still works (should not require network).

---

## Task 15: Build and Verify No Regressions

**Files:**
- None (build verification)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (including new tests from Tasks 2 and 12).

- [ ] **Step 2: Run type checker**

```bash
npm run typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 3: Build production web bundle + static pages**

```bash
npm run predeploy
```

(Runs `generate:static-pages` then `expo export --platform web --clear` — there is no separate generic `build` script in this repo.)

Expected: Build succeeds with no errors.

- [ ] **Step 4: Verify static pages are generated**

```bash
ls -la public/memory-export-with-okf/
ls -la public/sitemap.xml
```

Expected: Both files exist.

- [ ] **Step 5: Smoke test landing page**

Open the app's landing page in browser. Verify:
- OKF feature card appears in Features section
- Card text and icon render correctly
- "Learn More" link points to `/memory-export-with-okf`

- [ ] **Step 6: Smoke test FAQ page**

Open FAQ/support page. Verify:
- New Q&A about export appears
- Link to `/memory-export-with-okf` is present

- [ ] **Step 7: Verify privacy policy bumped**

Check that privacy policy version is updated to 1.6 and "Data Portability" section exists.

---

## Task 16: Final Commit and Documentation

**Files:**
- Document saved

- [ ] **Step 1: Review commits**

```bash
git log --oneline -20
```

Verify all feature commits are present (deps, edge augmentation, save utility, hook, UI, public docs, tests).

- [ ] **Step 2: Optional — Create PR**

If your workflow uses PRs (per `docs/GIT_WORKFLOW.md`):

```bash
git push origin feat
gh pr create \
  --title "feat: export character memory as OKF bundles" \
  --body "Implements V1 OKF export feature per spec 2026-07-03.

## Summary

- Client-side memory export via wiki.exportDump() + formatOkfBundle
- Edge augmentation appends markdown links to concept files
- Platform-aware save: web blob download, mobile filesystem + share sheet
- Includes README, sanitized filenames, dangling-edge handling
- Public docs: landing card, dedicated explainer, FAQ, privacy policy

## Testing

- Unit: edge augmentation (id extraction, link paths, dangling edges)
- Integration: full export flow with ZIP generation
- Manual: web blob download, mobile share sheet, empty bundle, offline"
```

---

## Self-Review Checklist

**Spec Coverage:**

- [x] **Problem / Goals:** Export memory (facts, tasks, events, edges) with round-trip safety
- [x] **Architecture:** Client-side `exportDump` → `formatOkfBundle` → edge augmentation → zip → platform save
- [x] **Edge Augmentation:** Frontmatter id extraction, relative links, dangling-edge skip (Tasks 2, 13–14)
- [x] **Platform-Aware Save:** Web blob + mobile filesystem (Task 3, 13–14)
- [x] **README.md:** Static content explaining OKF, how to use export (Task 4)
- [x] **Bundle Structure:** `entities/{id}/facts/`, `tasks/`, `log.md`, per-entity index (Tasks 2, 5, 13–14)
- [x] **UI Integration:** Settings button, loading state, error toast, retry (Tasks 6, 13–14)
- [x] **Public Documentation:** Landing card, explainer page, FAQ, privacy update (Tasks 7–11)
- [x] **Dependencies:** `jszip`, `expo-sharing` (Task 1)
- [x] **Testing:** Unit (augmentation), integration (full flow), manual (web/mobile) (Tasks 2, 12–14)
- [x] **Error Handling:** Empty bundle, dangling edges, ZIP failure, platform-save failure (Task 5, integration test)

**Placeholder Scan:**

- ✅ All code blocks contain actual, executable implementations
- ✅ All imports use real package names (no TBD placeholders)
- ✅ All file paths are exact and tested (e.g., `src/utils/augmentWithEdgeLinks.ts`)
- ✅ Test code is complete (not "add tests for the above")
- ✅ Error messages are specific (not "handle edge cases")

**Type Consistency:**

- ✅ `WikiEdge` imported from `@equationalapplications/expo-llm-wiki` (real re-export, verified against `core-llm-wiki`'s export list) — no more locally-duplicated interface in augmentation utility and hook
- ✅ `OkfFile` is NOT re-exported by `expo-llm-wiki` (verified: `core-llm-wiki` imports it from `core-okf` internally but doesn't re-export the type) — derived locally as `ReturnType<typeof formatOkfBundle>['files'][number]` in both `augmentWithEdgeLinks.ts` and the hook
- ✅ Platform resolved via `.ts`/`.web.ts` file split (Task 3) — no runtime `Platform.OS` branch in either file or the calling hook
- ✅ Function names: `augmentWithEdgeLinks`, `zipAndSaveOKF`, `useExportCharacterOKF` (consistent camelCase)
- ✅ Native save (Task 3) uses the `File`/`Paths` class API, not the deprecated `writeAsStringAsync`/`cacheDirectory` root exports — those throw at runtime on the installed `expo-file-system@~56.0.8` despite typechecking cleanly

**Gaps or Missing Tasks (fixed after cross-check against installed packages and real repo files):**

- Fixed: `OkfFile` was imported as if re-exported by `expo-llm-wiki` — it isn't; now derived from `formatOkfBundle`'s return type everywhere it's used (Tasks 2, 5)
- Fixed: Task 3's native save used `expo-file-system` legacy `writeAsStringAsync`/`cacheDirectory`, which throw at runtime on the installed v56 — switched to the `File`/`Paths` API already used elsewhere in this repo (`useAvatarUpload.ts`)
- Fixed: `augmentWithEdgeLinks`'s frontmatter-id regex used a bare `m` flag with no concept-file filter, so it could false-match a `---` thematic break inside a fact body or scan `log.md`/`index.md` — now filtered to concept files and anchored to the file start
- Fixed: dead ternary in the cross-type link branch (`goUp` was always `'../'` in that branch) — simplified
- Fixed: spec called for success and empty-bundle toasts (Task 13 manual-test steps 4 and 8 assert on them) but the hook only exposed `error`, and Task 6 wired only the error path — hook now returns `lastResult: { isEmpty }`, Task 6 wires a success/empty toast alongside the error one
- Fixed: spec called for an error toast "with retry option" but the `Snackbar` in `edit.tsx` renders `action={undefined}` — Task 6 now threads an `onRetry` through `toastState` into the `Snackbar`'s `action` prop
- Fixed: Task 9's FAQ snippet assumed a `{question, answer}` array and `<a href>` JSX; the real `app/support.tsx` is a React Native screen with hand-written `Text` pairs in a `Card` and `Linking.openURL`-based navigation (see its existing `onPressEmail`, which also branches on `Platform.OS` for web vs. native) — snippet rewritten to match, with an absolute URL since `Linking.openURL`/`window.location.assign` don't resolve app-relative paths
- Fixed: Task 12's integration test mock for `dump.entities.char_123` only included `edges`, but the hook's new `isEmpty` check reads `.length` off `facts`/`tasks`/`events` — mock updated to include all three
