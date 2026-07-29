# Image Pipeline Refactor (Phase 1: Avatars) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move character avatars out of the single `characters.avatar_data` base64 column into a per-character image gallery backed by Firebase Storage (cloud mode) or on-device storage (privacy mode), with multi-device sync, a FIFO cap, and a bundled default avatar.

**Architecture:** A new local `character_images` table holds one row per image with a `storage_kind` discriminator (`cloud` | `file` | `inline`). All reads go through a platform-split resolver (`localImageStore.ts` / `.web.ts`) that turns a row into a displayable URI. All writes go through `characterImageService.saveCharacterImage`, which normalizes/resizes, routes on the character's `save_to_cloud` flag, inserts the row, and enforces the cap. Cloud sync is a dedicated tombstone-based flow (`characterImageSyncService.ts` + a new `syncCharacterImages` callable) sequenced *after* character sync, because image ids are minted client-side but storage paths are keyed on the server-confirmed `cloud_id`.

**Tech Stack:** Expo SDK 56, React Native + react-native-web, `expo-sqlite` (OPFS on web), `expo-file-system`, `expo-image-manipulator`, `expo-image-picker`, `@react-native-firebase/storage` (native) / `firebase/storage` (web), Firebase Cloud Functions v2, Drizzle ORM + Cloud SQL Postgres, Jest (app) + `node:test` (functions).

**Spec:** `docs/superpowers/specs/2026-07-28-image-pipeline-refactor-design.md`

---

## Scope note

The spec spans four subsystems that are **sequentially dependent**, not independent, so this is one plan organized into four stages. Each stage ends with working, shippable software:

| Stage | Tasks | Ships |
|---|---|---|
| **A — Local gallery** | 1–11 | Avatars work end-to-end with zero cloud involvement: gallery table, resolver, picker UI, bundled default, migration off `avatar_data`. |
| **B — Cloud storage** | 12–14 | Cloud-mode characters store bytes in Firebase Storage instead of SQLite. |
| **C — Cloud sync** | 15–21 | Multi-device sync, server-side cap, tombstone reconciliation, privacy toggle, cascade deletes. |
| **D — Public import** | 22–23 | Signed-URL avatar import for shared characters. |
| **Verification** | 24 | Full suite, lint, typecheck, manual passes on web and native. |

Stopping after Stage A leaves the app strictly better than today (history preserved, default de-duplicated, square uploads). Stopping after Stage B leaves cloud backup working but single-device.

---

## File structure

**New — local storage layer**
| Path | Responsibility |
|---|---|
| `src/database/characterImageDatabase.ts` | All SQL against `character_images` + `characters.active_image_id`. No business logic. |
| `src/services/localImageStore.ts` | Native: resolve a row → URI, write/delete bytes under the document directory. |
| `src/services/localImageStore.web.ts` | Web: same interface; `inline` rows only, bytes live in the row. |
| `src/utilities/webpSupport.ts` | Canvas WebP encoding probe (§9); picks `SaveFormat` + MIME. |
| `src/services/imageVariants.ts` | Resize-to-1024 master + 256 thumb. Shared by save path and migration. |

**New — write/read orchestration**
| Path | Responsibility |
|---|---|
| `src/services/characterImageService.ts` | `saveCharacterImage`, cap eviction, deletion cascade. The only public write entry point. |
| `src/hooks/useResolvedImage.ts` | Row id → resolved URI for React consumers. |

**New — cloud**
| Path | Responsibility |
|---|---|
| `src/services/storageService.ts` / `.web.ts` | Firebase Storage upload/download/delete/getDownloadURL, platform-split. |
| `src/services/characterImageSyncService.ts` | Sweeper, reconciliation, privacy-mode promotion/demotion. |
| `storage.rules` | uid isolation, content-type + size limits. |
| `functions/src/services/characterImageService.ts` | Cloud-side row CRUD + server-authoritative cap. |
| `functions/src/services/storageAdmin.ts` | Admin-SDK object/prefix delete + V4 signed URLs. |
| `functions/drizzle/0022_character_images.sql` | Hand-written DDL (do **not** run `drizzle-kit generate`). |

**New — UI/assets**
| Path | Responsibility |
|---|---|
| `src/components/AvatarPicker.tsx` | Modal grid of thumbs; activate/delete; hosts Generate + Upload. |
| `assets/default-avatar-1024.webp` | Bundled default, no per-character copy. |
| `src/database/migrations/migrateAvatarsToImageStore.ts` | One-shot JS data move off `avatar_data`. |

**Deleted:** `src/utilities/defaultAvatarBase64.ts`, `src/utilities/loadDefaultAvatar.ts`, `src/services/defaultAvatarService.ts`, `src/services/localImageStorageService.ts`.

---

## Shared type contract

Every task below uses these exact names. Defined in Task 1; referenced verbatim afterwards.

```ts
// src/database/characterImageDatabase.ts
export type ImageStorageKind = 'cloud' | 'file' | 'inline'
export type ImageSource = 'generated' | 'uploaded' | 'imported'
export type ImageSyncState = 'local' | 'synced' | 'pending_upload' | 'pending_delete' | 'failed'

export interface CharacterImageRow {
  id: string
  character_id: string
  user_id: string
  storage_kind: ImageStorageKind
  master_ref: string
  thumb_ref: string | null
  mime_type: string
  source: ImageSource
  sync_state: ImageSyncState
  sync_attempts: number
  created_at: number
  deleted_at: number | null
}
```

---

# Stage A — Local gallery

## Task 1: Local schema (migrations 22 + 23)

**Files:**
- Modify: `src/database/schema.ts`
- Test: `__tests__/characterImageSchema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImageSchema.test.ts`:

```ts
import {
  SCHEMA_VERSION,
  MIGRATIONS,
  MIGRATION_SKIP_GUARDS,
  CREATE_TABLES,
  LATEST_SCHEMA_REQUIRED_COLUMNS,
} from '../src/database/schema'

describe('character_images schema', () => {
  it('bumps SCHEMA_VERSION to 23', () => {
    expect(SCHEMA_VERSION).toBe(23)
  })

  it('migration 22 creates the character_images table and its indexes', () => {
    const sql = MIGRATIONS[22]
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS character_images')
    expect(sql).toContain('storage_kind TEXT NOT NULL')
    expect(sql).toContain("sync_state TEXT NOT NULL DEFAULT 'local'")
    expect(sql).toContain('idx_character_images_char')
    expect(sql).toContain('idx_character_images_sync')
  })

  it('migration 23 adds characters.active_image_id', () => {
    expect(MIGRATIONS[23]).toContain('ALTER TABLE characters ADD COLUMN active_image_id TEXT')
  })

  it('guards both migrations so legacy databases can skip them', () => {
    expect(MIGRATION_SKIP_GUARDS[22]).toEqual([
      { table: 'character_images', column: 'id' },
    ])
    expect(MIGRATION_SKIP_GUARDS[23]).toEqual([
      { table: 'characters', column: 'active_image_id' },
    ])
  })

  it('creates the same objects on a fresh install', () => {
    expect(CREATE_TABLES).toContain('CREATE TABLE IF NOT EXISTS character_images')
    expect(CREATE_TABLES).toContain('active_image_id TEXT')
    expect(LATEST_SCHEMA_REQUIRED_COLUMNS.characters).toContain('active_image_id')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImageSchema.test.ts`
Expected: FAIL — `expect(received).toBe(expected) // Expected: 23, Received: 21`

- [ ] **Step 3: Implement**

In `src/database/schema.ts`:

Change line 8 to:
```ts
export const SCHEMA_VERSION = 23
```

Add `'active_image_id'` to the end of the `characters` array in `LATEST_SCHEMA_REQUIRED_COLUMNS` (after `'pending_cloud_id',`).

Add to `MIGRATION_SKIP_GUARDS` (after the `20:` entry):
```ts
  22: [{ table: 'character_images', column: 'id' }],
  23: [{ table: 'characters', column: 'active_image_id' }],
```

Inside the `CREATE_TABLES` template literal, add `active_image_id TEXT,` to the `characters` table body — put it immediately after the `memory_checkpoint` line, changing that line to end with a comma:
```sql
    memory_checkpoint INTEGER NOT NULL DEFAULT 0,
    active_image_id TEXT
  );
```

Still inside `CREATE_TABLES`, add this block just before the `-- Schema version tracking` comment:
```sql
  -- Character images (avatar gallery)
  CREATE TABLE IF NOT EXISTS character_images (
    id            TEXT PRIMARY KEY NOT NULL,
    character_id  TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    storage_kind  TEXT NOT NULL,
    master_ref    TEXT NOT NULL,
    thumb_ref     TEXT,
    mime_type     TEXT NOT NULL DEFAULT 'image/webp',
    source        TEXT NOT NULL,
    sync_state    TEXT NOT NULL DEFAULT 'local',
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    deleted_at    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_character_images_char
    ON character_images(character_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_character_images_sync
    ON character_images(sync_state)
    WHERE sync_state IN ('pending_upload', 'pending_delete');
```

Append to `MIGRATIONS` (after the `21:` entry):
```ts
  // Avatar gallery. One row per image; storage_kind discriminates cloud objects,
  // on-device files, and inline base64 (web privacy mode). sync_state defaults to
  // 'local' — NOT 'synced' — so a careless sweeper WHERE clause can never treat a
  // privacy-mode row as "already uploaded" and push it to the cloud.
  22: `CREATE TABLE IF NOT EXISTS character_images (
  id            TEXT PRIMARY KEY NOT NULL,
  character_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  storage_kind  TEXT NOT NULL,
  master_ref    TEXT NOT NULL,
  thumb_ref     TEXT,
  mime_type     TEXT NOT NULL DEFAULT 'image/webp',
  source        TEXT NOT NULL,
  sync_state    TEXT NOT NULL DEFAULT 'local',
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_character_images_char ON character_images(character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_character_images_sync ON character_images(sync_state) WHERE sync_state IN ('pending_upload', 'pending_delete')`,
  23: `ALTER TABLE characters ADD COLUMN active_image_id TEXT;`,
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImageSchema.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/database/schema.ts __tests__/characterImageSchema.test.ts
git commit -m "feat(db): add character_images table and active_image_id (migrations 22, 23)"
```

---

## Task 2: `characterImageDatabase` CRUD

**Files:**
- Create: `src/database/characterImageDatabase.ts`
- Test: `__tests__/characterImageDatabase.test.ts` (create)

This module owns every SQL statement touching `character_images`. No routing, no bytes, no network — pure persistence, so the service layer above it can be tested against a mock of *this* module rather than a mock of SQLite.

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImageDatabase.test.ts`:

```ts
const mockRunAsync = jest.fn()
const mockGetAllAsync = jest.fn().mockResolvedValue([])
const mockGetFirstAsync = jest.fn().mockResolvedValue(null)
const mockWithTransactionAsync = jest.fn(async (cb: () => Promise<void>) => cb())

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(async () => ({
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
    getFirstAsync: mockGetFirstAsync,
    withTransactionAsync: mockWithTransactionAsync,
  })),
}))

import {
  insertCharacterImage,
  getCharacterImages,
  getCharacterImageById,
  getActiveCharacterImage,
  setActiveImageId,
  countCharacterImages,
  getEvictionCandidates,
  hardDeleteCharacterImage,
  softDeleteCharacterImage,
  setImageSyncState,
  incrementSyncAttempts,
  updateImageRefs,
  getImagesBySyncState,
  getAllImagesForCharacter,
  type CharacterImageRow,
} from '../src/database/characterImageDatabase'

function row(overrides: Partial<CharacterImageRow> = {}): CharacterImageRow {
  return {
    id: 'img-1',
    character_id: 'char_a',
    user_id: 'user-1',
    storage_kind: 'inline',
    master_ref: 'BASE64',
    thumb_ref: null,
    mime_type: 'image/webp',
    source: 'generated',
    sync_state: 'local',
    sync_attempts: 0,
    created_at: 1000,
    deleted_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAllAsync.mockResolvedValue([])
  mockGetFirstAsync.mockResolvedValue(null)
})

describe('characterImageDatabase', () => {
  it('inserts every column of a row', async () => {
    await insertCharacterImage(row())
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toContain('INSERT INTO character_images')
    expect(params).toEqual([
      'img-1', 'char_a', 'user-1', 'inline', 'BASE64', null,
      'image/webp', 'generated', 'local', 0, 1000, null,
    ])
  })

  it('lists only live images, newest first', async () => {
    await getCharacterImages('char_a')
    const [sql, params] = mockGetAllAsync.mock.calls[0]
    expect(sql).toContain('WHERE character_id = ? AND deleted_at IS NULL')
    expect(sql).toContain('ORDER BY created_at DESC')
    expect(params).toEqual(['char_a'])
  })

  it('getAllImagesForCharacter includes soft-deleted rows', async () => {
    await getAllImagesForCharacter('char_a')
    const [sql] = mockGetAllAsync.mock.calls[0]
    expect(sql).not.toContain('deleted_at IS NULL')
  })

  it('resolves the active image through characters.active_image_id', async () => {
    await getActiveCharacterImage('char_a')
    const [sql, params] = mockGetFirstAsync.mock.calls[0]
    expect(sql).toContain('JOIN characters c ON c.active_image_id = i.id')
    expect(params).toEqual(['char_a'])
  })

  it('counts only live images', async () => {
    mockGetFirstAsync.mockResolvedValue({ count: 7 })
    await expect(countCharacterImages('char_a')).resolves.toBe(7)
    expect(mockGetFirstAsync.mock.calls[0][0]).toContain('deleted_at IS NULL')
  })

  it('never returns the active image as an eviction candidate', async () => {
    await getEvictionCandidates('char_a', 'img-active', 3)
    const [sql, params] = mockGetAllAsync.mock.calls[0]
    expect(sql).toContain('ORDER BY created_at ASC')
    expect(sql).toContain('AND id != ?')
    expect(params).toEqual(['char_a', 'img-active', 3])
  })

  it('tolerates a null active id when picking eviction candidates', async () => {
    await getEvictionCandidates('char_a', null, 1)
    const [, params] = mockGetAllAsync.mock.calls[0]
    expect(params).toEqual(['char_a', '', 1])
  })

  it('soft-delete stamps deleted_at and the given sync state', async () => {
    await softDeleteCharacterImage('img-1', 'pending_delete')
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toContain('SET deleted_at = ?, sync_state = ?')
    expect(params[1]).toBe('pending_delete')
    expect(params[2]).toBe('img-1')
  })

  it('increments sync_attempts in place', async () => {
    await incrementSyncAttempts('img-1')
    expect(mockRunAsync.mock.calls[0][0]).toContain('sync_attempts = sync_attempts + 1')
  })

  it('updateImageRefs rewrites kind, refs and mime together', async () => {
    await updateImageRefs('img-1', {
      storage_kind: 'cloud',
      master_ref: 'users/u/characters/c/img-1.webp',
      thumb_ref: 'users/u/characters/c/img-1_thumb.webp',
      mime_type: 'image/webp',
      sync_state: 'synced',
    })
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toContain('storage_kind = ?')
    expect(sql).toContain('sync_state = ?')
    expect(params).toEqual([
      'cloud',
      'users/u/characters/c/img-1.webp',
      'users/u/characters/c/img-1_thumb.webp',
      'image/webp',
      'synced',
      'img-1',
    ])
  })

  it('queries sweepable rows by state for one user', async () => {
    await getImagesBySyncState('user-1', ['pending_upload', 'pending_delete'])
    const [sql, params] = mockGetAllAsync.mock.calls[0]
    expect(sql).toContain("sync_state IN (?,?)")
    expect(params).toEqual(['user-1', 'pending_upload', 'pending_delete'])
  })

  it('setActiveImageId writes through to characters', async () => {
    await setActiveImageId('char_a', 'img-1')
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toContain('UPDATE characters SET active_image_id = ?')
    expect(params).toEqual([expect.any(Number), 'img-1', 'char_a'])
  })

  it('hard delete removes exactly one row by id', async () => {
    await hardDeleteCharacterImage('img-1')
    expect(mockRunAsync).toHaveBeenCalledWith(
      'DELETE FROM character_images WHERE id = ?',
      ['img-1'],
    )
  })

  it('reads a single row by id', async () => {
    mockGetFirstAsync.mockResolvedValue(row())
    await expect(getCharacterImageById('img-1')).resolves.toMatchObject({ id: 'img-1' })
  })

  it('setImageSyncState updates just the state', async () => {
    await setImageSyncState('img-1', 'failed')
    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE character_images SET sync_state = ? WHERE id = ?',
      ['failed', 'img-1'],
    )
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImageDatabase.test.ts`
Expected: FAIL — `Cannot find module '../src/database/characterImageDatabase'`

- [ ] **Step 3: Implement**

Create `src/database/characterImageDatabase.ts`:

```ts
/**
 * Persistence layer for the character avatar gallery.
 *
 * Every SQL statement touching `character_images` (and `characters.active_image_id`)
 * lives here. Routing, byte handling, and network work belong to the service layer
 * above — keeping this module SQL-only is what lets those services be tested
 * against a mock of this file instead of a mock of SQLite.
 */

import { getDatabase } from './index'

export type ImageStorageKind = 'cloud' | 'file' | 'inline'
export type ImageSource = 'generated' | 'uploaded' | 'imported'
export type ImageSyncState =
  | 'local'
  | 'synced'
  | 'pending_upload'
  | 'pending_delete'
  | 'failed'

export interface CharacterImageRow {
  id: string
  character_id: string
  user_id: string
  storage_kind: ImageStorageKind
  master_ref: string
  thumb_ref: string | null
  mime_type: string
  source: ImageSource
  sync_state: ImageSyncState
  sync_attempts: number
  created_at: number
  deleted_at: number | null
}

export async function insertCharacterImage(row: CharacterImageRow): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT INTO character_images
     (id, character_id, user_id, storage_kind, master_ref, thumb_ref, mime_type, source, sync_state, sync_attempts, created_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.character_id,
      row.user_id,
      row.storage_kind,
      row.master_ref,
      row.thumb_ref,
      row.mime_type,
      row.source,
      row.sync_state,
      row.sync_attempts,
      row.created_at,
      row.deleted_at,
    ],
  )
}

/** Live images for a character, newest first — what the picker renders. */
export async function getCharacterImages(characterId: string): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    'SELECT * FROM character_images WHERE character_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    [characterId],
  )
}

/** Includes soft-deleted rows — used by the sync sweeper and cascade deletes. */
export async function getAllImagesForCharacter(characterId: string): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    'SELECT * FROM character_images WHERE character_id = ? ORDER BY created_at DESC',
    [characterId],
  )
}

export async function getCharacterImageById(imageId: string): Promise<CharacterImageRow | null> {
  const db = await getDatabase()
  return db.getFirstAsync<CharacterImageRow>(
    'SELECT * FROM character_images WHERE id = ?',
    [imageId],
  )
}

export async function getActiveCharacterImage(characterId: string): Promise<CharacterImageRow | null> {
  const db = await getDatabase()
  return db.getFirstAsync<CharacterImageRow>(
    `SELECT i.* FROM character_images i
     JOIN characters c ON c.active_image_id = i.id
     WHERE c.id = ? AND i.deleted_at IS NULL`,
    [characterId],
  )
}

export async function setActiveImageId(characterId: string, imageId: string | null): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE characters SET updated_at = ?, active_image_id = ? WHERE id = ?',
    [Date.now(), imageId, characterId],
  )
}

export async function countCharacterImages(characterId: string): Promise<number> {
  const db = await getDatabase()
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM character_images WHERE character_id = ? AND deleted_at IS NULL',
    [characterId],
  )
  return result?.count ?? 0
}

/**
 * Oldest live images for a character, excluding the active one.
 *
 * `activeImageId` is coalesced to '' rather than passed as NULL: `id != NULL`
 * is NULL in SQL, not true, so a NULL parameter would silently match nothing
 * and the cap would never evict.
 */
export async function getEvictionCandidates(
  characterId: string,
  activeImageId: string | null,
  limit: number,
): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE character_id = ? AND deleted_at IS NULL AND id != ?
     ORDER BY created_at ASC
     LIMIT ?`,
    [characterId, activeImageId ?? '', limit],
  )
}

export async function softDeleteCharacterImage(
  imageId: string,
  syncState: ImageSyncState,
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE character_images SET deleted_at = ?, sync_state = ? WHERE id = ?',
    [Date.now(), syncState, imageId],
  )
}

export async function hardDeleteCharacterImage(imageId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM character_images WHERE id = ?', [imageId])
}

export async function setImageSyncState(
  imageId: string,
  syncState: ImageSyncState,
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync('UPDATE character_images SET sync_state = ? WHERE id = ?', [
    syncState,
    imageId,
  ])
}

export async function incrementSyncAttempts(imageId: string): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    'UPDATE character_images SET sync_attempts = sync_attempts + 1 WHERE id = ?',
    [imageId],
  )
}

export async function updateImageRefs(
  imageId: string,
  refs: {
    storage_kind: ImageStorageKind
    master_ref: string
    thumb_ref: string | null
    mime_type: string
    sync_state: ImageSyncState
  },
): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `UPDATE character_images
     SET storage_kind = ?, master_ref = ?, thumb_ref = ?, mime_type = ?, sync_state = ?
     WHERE id = ?`,
    [
      refs.storage_kind,
      refs.master_ref,
      refs.thumb_ref,
      refs.mime_type,
      refs.sync_state,
      imageId,
    ],
  )
}

export async function getImagesBySyncState(
  userId: string,
  states: ImageSyncState[],
): Promise<CharacterImageRow[]> {
  const db = await getDatabase()
  const placeholders = states.map(() => '?').join(',')
  return db.getAllAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE user_id = ? AND sync_state IN (${placeholders})
     ORDER BY created_at ASC`,
    [userId, ...states],
  )
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImageDatabase.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/database/characterImageDatabase.ts __tests__/characterImageDatabase.test.ts
git commit -m "feat(db): add characterImageDatabase CRUD layer"
```

---

## Task 3: WebP encoding probe

**Files:**
- Create: `src/utilities/webpSupport.ts`
- Test: `__tests__/webpSupport.test.ts` (create)

`expo-image-manipulator` on web encodes via `canvas.toDataURL('image/webp')`. Browsers without WebP canvas encoding return **PNG silently** rather than throwing, so the only reliable check is the returned data-URI prefix.

- [ ] **Step 1: Write the failing test**

Create `__tests__/webpSupport.test.ts`:

```ts
import { SaveFormat } from 'expo-image-manipulator'

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' },
}))

function loadModule() {
  let mod: typeof import('../src/utilities/webpSupport')
  jest.isolateModules(() => {
    mod = require('../src/utilities/webpSupport')
  })
  return mod!
}

const realDocument = global.document

afterEach(() => {
  // @ts-expect-error test teardown
  global.document = realDocument
  jest.resetModules()
})

function stubCanvas(dataUrl: string | null) {
  // @ts-expect-error jsdom-free stub
  global.document = {
    createElement: () => ({
      getContext: () => (dataUrl === null ? null : {}),
      toDataURL: () => dataUrl,
    }),
  }
}

describe('webpSupport', () => {
  it('reports WebP support when the canvas actually returns a WebP data URI', () => {
    stubCanvas('data:image/webp;base64,UklGRg==')
    const { isWebpSupported, getEncodeTarget } = loadModule()
    expect(isWebpSupported()).toBe(true)
    expect(getEncodeTarget()).toEqual({ format: SaveFormat.WEBP, mimeType: 'image/webp' })
  })

  it('detects the silent PNG fallback and downgrades to JPEG', () => {
    stubCanvas('data:image/png;base64,iVBORw0KGgo=')
    const { isWebpSupported, getEncodeTarget } = loadModule()
    expect(isWebpSupported()).toBe(false)
    expect(getEncodeTarget()).toEqual({ format: SaveFormat.JPEG, mimeType: 'image/jpeg' })
  })

  it('downgrades when there is no 2d context at all', () => {
    stubCanvas(null)
    expect(loadModule().isWebpSupported()).toBe(false)
  })

  it('assumes WebP on native, where there is no document', () => {
    // @ts-expect-error native has no DOM
    global.document = undefined
    expect(loadModule().isWebpSupported()).toBe(true)
  })

  it('probes the canvas only once', () => {
    let calls = 0
    // @ts-expect-error jsdom-free stub
    global.document = {
      createElement: () => ({
        getContext: () => ({}),
        toDataURL: () => {
          calls += 1
          return 'data:image/webp;base64,UklGRg=='
        },
      }),
    }
    const { isWebpSupported } = loadModule()
    isWebpSupported()
    isWebpSupported()
    isWebpSupported()
    expect(calls).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/webpSupport.test.ts`
Expected: FAIL — `Cannot find module '../src/utilities/webpSupport'`

- [ ] **Step 3: Implement**

Create `src/utilities/webpSupport.ts`:

```ts
import { SaveFormat } from 'expo-image-manipulator'

export interface EncodeTarget {
  format: SaveFormat
  mimeType: 'image/webp' | 'image/jpeg'
}

let cached: boolean | null = null

/**
 * Whether this runtime can actually encode WebP.
 *
 * Native always can: expo-image-manipulator@56 ships SDImageWebPCoder on iOS and
 * Android has encoded WebP for years, so the historical "WEBP is Android-only"
 * limitation no longer applies.
 *
 * On web the check must inspect the returned prefix. Browsers without WebP canvas
 * encoding (Safari < 17) return a PNG data URI from `toDataURL('image/webp')`
 * instead of throwing, so a try/catch would report false success.
 */
export function isWebpSupported(): boolean {
  if (cached !== null) return cached

  if (typeof document === 'undefined') {
    cached = true
    return cached
  }

  try {
    const canvas = document.createElement('canvas')
    const supported =
      typeof canvas.getContext === 'function' && canvas.getContext('2d')
        ? canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0
        : false
    cached = supported
  } catch {
    cached = false
  }

  return cached
}

/** The format/MIME pair to hand to the manipulator and record on the row. */
export function getEncodeTarget(): EncodeTarget {
  return isWebpSupported()
    ? { format: SaveFormat.WEBP, mimeType: 'image/webp' }
    : { format: SaveFormat.JPEG, mimeType: 'image/jpeg' }
}

/** Test seam: clears the memoized probe result. */
export function __resetWebpProbeForTests(): void {
  cached = null
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/webpSupport.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utilities/webpSupport.ts __tests__/webpSupport.test.ts
git commit -m "feat(images): add canvas WebP encoding probe with JPEG fallback"
```

---

## Task 4: Master + thumbnail derivation

**Files:**
- Create: `src/services/imageVariants.ts`
- Test: `__tests__/imageVariants.test.ts` (create)

Resize to 1024 on the longest edge **never upscaling**, and derive a 256 thumb. Extracted as its own module because the migration pass (Task 9) and the Vision feature (out of scope, §18) reuse it verbatim.

- [ ] **Step 1: Write the failing test**

Create `__tests__/imageVariants.test.ts`:

```ts
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { File } from 'expo-file-system'
import { prepareImageVariants, MASTER_DIMENSION, THUMB_DIMENSION } from '~/services/imageVariants'

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' },
}))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))
jest.mock('~/utilities/webpSupport', () => ({
  getEncodeTarget: () => ({ format: 'webp', mimeType: 'image/webp' }),
}))

const mockManipulate = jest.mocked(manipulateAsync)
const MockFile = jest.mocked(File)
const deleted: string[] = []

function setupFiles(base64ByUri: Record<string, string>) {
  deleted.length = 0
  MockFile.mockImplementation((uri: unknown) => {
    const key = String(uri)
    return {
      base64: async () => base64ByUri[key] ?? 'UNKNOWN',
      delete: () => { deleted.push(key) },
    } as never
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  setupFiles({ 'file://master.webp': 'MASTER64', 'file://thumb.webp': 'THUMB64' })
  mockManipulate
    .mockResolvedValueOnce({ uri: 'file://master.webp', width: 1024, height: 1024 } as never)
    .mockResolvedValueOnce({ uri: 'file://thumb.webp', width: 256, height: 256 } as never)
})

describe('prepareImageVariants', () => {
  it('exposes the spec dimensions', () => {
    expect(MASTER_DIMENSION).toBe(1024)
    expect(THUMB_DIMENSION).toBe(256)
  })

  it('returns base64 master and thumb tagged with the encode target mime', async () => {
    const result = await prepareImageVariants({
      uri: 'file://source.jpg',
      width: 2048,
      height: 2048,
    })
    expect(result).toEqual({
      master: { base64: 'MASTER64', mimeType: 'image/webp' },
      thumb: { base64: 'THUMB64', mimeType: 'image/webp' },
    })
  })

  it('resizes the master on the longest edge when the source is oversized', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 4000, height: 2000 })
    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { width: 1024 } }])
  })

  it('resizes on height when the source is taller than it is wide', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 2000, height: 4000 })
    expect(mockManipulate.mock.calls[0][1]).toEqual([{ resize: { height: 1024 } }])
  })

  it('never upscales: an 800x800 source is left at 800', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 })
    expect(mockManipulate.mock.calls[0][1]).toEqual([])
  })

  it('always derives the thumb from the master at 256', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 })
    expect(mockManipulate.mock.calls[1][0]).toBe('file://master.webp')
    expect(mockManipulate.mock.calls[1][1]).toEqual([{ resize: { width: 256 } }])
  })

  it('deletes both temp files even when the caller succeeds', async () => {
    await prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 })
    expect(deleted).toEqual(expect.arrayContaining(['file://master.webp', 'file://thumb.webp']))
  })

  it('deletes temp files when reading base64 throws', async () => {
    MockFile.mockImplementation((uri: unknown) => ({
      base64: async () => { throw new Error('read failed') },
      delete: () => { deleted.push(String(uri)) },
    }) as never)
    await expect(
      prepareImageVariants({ uri: 'file://source.jpg', width: 800, height: 800 }),
    ).rejects.toThrow('read failed')
    expect(deleted).toContain('file://master.webp')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/imageVariants.test.ts`
Expected: FAIL — `Cannot find module '~/services/imageVariants'`

- [ ] **Step 3: Implement**

Create `src/services/imageVariants.ts`:

```ts
/**
 * Derives the two stored representations of every character image:
 * a 1024 master and a 256 thumbnail.
 *
 * Shared verbatim by the write path (`characterImageService`), the legacy-avatar
 * migration, and — later — the Vision upload path. The thumb is not an
 * optimisation detail: the picker renders up to 100 images at once, which is
 * ~15 MB of masters versus ~1.2 MB of thumbs.
 */

import { File } from 'expo-file-system'
import { manipulateAsync } from 'expo-image-manipulator'
import { getEncodeTarget } from '~/utilities/webpSupport'

export const MASTER_DIMENSION = 1024
export const THUMB_DIMENSION = 256

export interface ImageVariant {
  base64: string
  mimeType: string
}

export interface ImageVariants {
  master: ImageVariant
  thumb: ImageVariant
}

export interface VariantSource {
  uri: string
  width: number
  height: number
}

/**
 * Resize on the longest edge, never upscaling — an 800×800 upload stays at 800.
 * Returns [] when the source already fits, so the manipulator only re-encodes.
 */
function resizeActions(width: number, height: number) {
  if (width <= MASTER_DIMENSION && height <= MASTER_DIMENSION) return []
  return [{ resize: width >= height ? { width: MASTER_DIMENSION } : { height: MASTER_DIMENSION } }]
}

export async function prepareImageVariants(source: VariantSource): Promise<ImageVariants> {
  const { format, mimeType } = getEncodeTarget()

  const master = await manipulateAsync(source.uri, resizeActions(source.width, source.height), {
    format,
    compress: 0.85,
  })

  const masterFile = new File(master.uri)
  let thumbFile: File | null = null

  try {
    // Derive the thumb from the already-normalised master, not the raw source:
    // one resize chain, and the thumb is guaranteed to match what is displayed.
    const thumb = await manipulateAsync(master.uri, [{ resize: { width: THUMB_DIMENSION } }], {
      format,
      compress: 0.8,
    })
    thumbFile = new File(thumb.uri)

    const [masterBase64, thumbBase64] = await Promise.all([
      masterFile.base64(),
      thumbFile.base64(),
    ])

    return {
      master: { base64: masterBase64, mimeType },
      thumb: { base64: thumbBase64, mimeType },
    }
  } finally {
    // Temp files from manipulateAsync are ours to clean up; failure to delete
    // must never mask the real error, so each is swallowed independently.
    for (const file of [masterFile, thumbFile]) {
      if (!file) continue
      try {
        file.delete()
      } catch (err) {
        console.warn('Failed to clean up temp image variant file:', err)
      }
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/imageVariants.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/imageVariants.ts __tests__/imageVariants.test.ts
git commit -m "feat(images): derive 1024 master and 256 thumb variants"
```

---

## Task 5: The resolver seam (`localImageStore`)

**Files:**
- Create: `src/services/localImageStore.ts` (native)
- Create: `src/services/localImageStore.web.ts` (web)
- Test: `__tests__/localImageStore.test.ts` (create)
- Test: `__tests__/localImageStoreWeb.test.ts` (create)

One function turns a row into something an `<Image>` can render. Dispatching on `storage_kind` here — rather than at each call site — is what keeps a future swap of the web backend (IndexedDB blobs, say) contained to one file.

`cloud` resolution is stubbed in this task (throws) and filled in during Stage B (Task 12); the native/web split and the `file`/`inline` paths are what Stage A needs.

- [ ] **Step 1: Write the failing native test**

Create `__tests__/localImageStore.test.ts`:

```ts
import { Directory, File, Paths } from 'expo-file-system'
import {
  resolveImageUri,
  writeLocalImageBytes,
  deleteLocalImageBytes,
} from '~/services/localImageStore'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///doc/' } },
  Directory: jest.fn(),
  File: jest.fn(),
}))

const MockDirectory = jest.mocked(Directory)
const MockFile = jest.mocked(File)
const written: Array<{ uri: string; base64: string }> = []
const deleted: string[] = []
let dirExists = true

beforeEach(() => {
  jest.clearAllMocks()
  written.length = 0
  deleted.length = 0
  dirExists = true
  MockDirectory.mockImplementation(() => ({
    get exists() { return dirExists },
    create: jest.fn(() => { dirExists = true }),
  }) as never)
  MockFile.mockImplementation((...args: unknown[]) => {
    const uri = args.length > 1 ? `${String(args[0])}${String(args[1])}` : String(args[0])
    return {
      uri,
      write: (data: string) => written.push({ uri, base64: data }),
      delete: () => deleted.push(uri),
      exists: true,
    } as never
  })
})

function row(overrides: Partial<CharacterImageRow>): CharacterImageRow {
  return {
    id: 'img-1',
    character_id: 'char_a',
    user_id: 'user-1',
    storage_kind: 'inline',
    master_ref: 'MASTER64',
    thumb_ref: null,
    mime_type: 'image/webp',
    source: 'generated',
    sync_state: 'local',
    sync_attempts: 0,
    created_at: 1,
    deleted_at: null,
    ...overrides,
  }
}

describe('localImageStore (native)', () => {
  it('returns file:// refs unchanged', async () => {
    const r = row({ storage_kind: 'file', master_ref: 'file:///doc/images/img-1.webp' })
    await expect(resolveImageUri(r, 'master')).resolves.toBe('file:///doc/images/img-1.webp')
  })

  it('builds a data URI for inline rows using the row mime type', async () => {
    const r = row({ storage_kind: 'inline', master_ref: 'MASTER64', mime_type: 'image/jpeg' })
    await expect(resolveImageUri(r, 'master')).resolves.toBe('data:image/jpeg;base64,MASTER64')
  })

  it('resolves the thumb variant when thumb_ref is present', async () => {
    const r = row({ storage_kind: 'inline', master_ref: 'M', thumb_ref: 'T' })
    await expect(resolveImageUri(r, 'thumb')).resolves.toBe('data:image/webp;base64,T')
  })

  it('falls back to the master when thumb_ref is NULL', async () => {
    const r = row({ storage_kind: 'inline', master_ref: 'M', thumb_ref: null })
    await expect(resolveImageUri(r, 'thumb')).resolves.toBe('data:image/webp;base64,M')
  })

  it('writes bytes under the document directory and returns the ref', async () => {
    const ref = await writeLocalImageBytes('img-1', 'BYTES', 'master')
    expect(ref).toBe('file:///doc/character-images/img-1.webp')
    expect(written).toEqual([{ uri: 'file:///doc/character-images/img-1.webp', base64: 'BYTES' }])
  })

  it('names the thumb variant distinctly so it cannot clobber the master', async () => {
    const ref = await writeLocalImageBytes('img-1', 'BYTES', 'thumb')
    expect(ref).toBe('file:///doc/character-images/img-1_thumb.webp')
  })

  it('creates the image directory when it does not exist yet', async () => {
    dirExists = false
    await writeLocalImageBytes('img-1', 'BYTES', 'master')
    expect(dirExists).toBe(true)
  })

  it('deletes bytes by ref', async () => {
    await deleteLocalImageBytes('file:///doc/character-images/img-1.webp')
    expect(deleted).toEqual(['file:///doc/character-images/img-1.webp'])
  })

  it('treats deleting an already-missing file as success', async () => {
    MockFile.mockImplementation(() => ({
      delete: () => { throw new Error('ENOENT') },
    }) as never)
    await expect(deleteLocalImageBytes('file:///gone.webp')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/localImageStore.test.ts`
Expected: FAIL — `Cannot find module '~/services/localImageStore'`

- [ ] **Step 3: Implement the native store**

Create `src/services/localImageStore.ts`:

```ts
/**
 * Native resolver seam: turns a `character_images` row into a URI a component
 * can render, and owns the on-device byte store for privacy-mode characters.
 *
 * Dispatching on `storage_kind` in exactly one place is what keeps the storage
 * backend swappable. Consumers never branch on kind themselves.
 */

import { Directory, File, Paths } from 'expo-file-system'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

export type ImageVariantName = 'master' | 'thumb'

const IMAGE_DIR_NAME = 'character-images'

function imageDirectory(): Directory {
  const dir = new Directory(Paths.document, IMAGE_DIR_NAME)
  if (!dir.exists) dir.create()
  return dir
}

function fileNameFor(imageId: string, variant: ImageVariantName): string {
  return variant === 'thumb' ? `${imageId}_thumb.webp` : `${imageId}.webp`
}

/**
 * Pick the ref for the requested variant.
 *
 * A NULL `thumb_ref` is not an error: legacy migrated rows have no thumb until
 * the background pass derives one, so 'thumb' degrades to the master.
 */
function refFor(row: CharacterImageRow, variant: ImageVariantName): string {
  if (variant === 'thumb' && row.thumb_ref) return row.thumb_ref
  return row.master_ref
}

export async function resolveImageUri(
  row: CharacterImageRow,
  variant: ImageVariantName,
): Promise<string> {
  const ref = refFor(row, variant)

  switch (row.storage_kind) {
    case 'file':
      return ref
    case 'inline':
      return `data:${row.mime_type};base64,${ref}`
    case 'cloud':
      // Filled in by the Firebase Storage seam in Stage B.
      throw new Error('Cloud image resolution is not available yet')
    default: {
      const exhaustive: never = row.storage_kind
      throw new Error(`Unknown storage_kind: ${String(exhaustive)}`)
    }
  }
}

export async function writeLocalImageBytes(
  imageId: string,
  base64: string,
  variant: ImageVariantName,
): Promise<string> {
  const dir = imageDirectory()
  const file = new File(dir, fileNameFor(imageId, variant))
  file.write(base64)
  return file.uri
}

/**
 * Idempotent by design: the deletion cascade re-runs after partial failures and
 * an already-missing file means the work is done, not that it failed.
 */
export async function deleteLocalImageBytes(ref: string): Promise<void> {
  try {
    new File(ref).delete()
  } catch (err) {
    console.warn('Failed to delete local image bytes (already gone?):', ref, err)
  }
}
```

- [ ] **Step 4: Run the native test and watch it pass**

Run: `npm test -- __tests__/localImageStore.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing web test**

Create `__tests__/localImageStoreWeb.test.ts`:

```ts
import {
  resolveImageUri,
  writeLocalImageBytes,
  deleteLocalImageBytes,
} from '~/services/localImageStore.web'
import type { CharacterImageRow } from '~/database/characterImageDatabase'

function row(overrides: Partial<CharacterImageRow>): CharacterImageRow {
  return {
    id: 'img-1',
    character_id: 'char_a',
    user_id: 'user-1',
    storage_kind: 'inline',
    master_ref: 'MASTER64',
    thumb_ref: null,
    mime_type: 'image/webp',
    source: 'generated',
    sync_state: 'local',
    sync_attempts: 0,
    created_at: 1,
    deleted_at: null,
    ...overrides,
  }
}

describe('localImageStore (web)', () => {
  it('builds data URIs for inline rows', async () => {
    await expect(resolveImageUri(row({}), 'master')).resolves.toBe('data:image/webp;base64,MASTER64')
  })

  it('falls back to the master when thumb_ref is NULL', async () => {
    await expect(resolveImageUri(row({}), 'thumb')).resolves.toBe('data:image/webp;base64,MASTER64')
  })

  it('returns the base64 unchanged as the ref — bytes live in the row on web', async () => {
    await expect(writeLocalImageBytes('img-1', 'BYTES', 'master')).resolves.toBe('BYTES')
  })

  it('deleting is a no-op on web because the row holds the bytes', async () => {
    await expect(deleteLocalImageBytes('BYTES')).resolves.toBeUndefined()
  })

  it('rejects file refs, which cannot exist on web', async () => {
    await expect(resolveImageUri(row({ storage_kind: 'file', master_ref: 'file://x' }), 'master'))
      .rejects.toThrow(/file-backed images are not available on web/i)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- __tests__/localImageStoreWeb.test.ts`
Expected: FAIL — `Cannot find module '~/services/localImageStore.web'`

- [ ] **Step 7: Implement the web store**

Create `src/services/localImageStore.web.ts`:

```ts
/**
 * Web resolver seam.
 *
 * There is no file system to write to, so privacy-mode images are `inline`:
 * base64 in the row itself. That is not a compromise — expo-sqlite@56 on web
 * runs on an OPFS sync-access-handle pool, so SQLite here *is* origin-private
 * storage, the same quota bucket and eviction rules IndexedDB draws from.
 * Keeping rows out of list queries (images have their own table) buys the one
 * genuine advantage a separate blob store would have offered.
 */

import type { CharacterImageRow } from '~/database/characterImageDatabase'

export type ImageVariantName = 'master' | 'thumb'

function refFor(row: CharacterImageRow, variant: ImageVariantName): string {
  if (variant === 'thumb' && row.thumb_ref) return row.thumb_ref
  return row.master_ref
}

export async function resolveImageUri(
  row: CharacterImageRow,
  variant: ImageVariantName,
): Promise<string> {
  const ref = refFor(row, variant)

  switch (row.storage_kind) {
    case 'inline':
      return `data:${row.mime_type};base64,${ref}`
    case 'file':
      throw new Error('file-backed images are not available on web')
    case 'cloud':
      // Filled in by the Firebase Storage seam in Stage B.
      throw new Error('Cloud image resolution is not available yet')
    default: {
      const exhaustive: never = row.storage_kind
      throw new Error(`Unknown storage_kind: ${String(exhaustive)}`)
    }
  }
}

/** On web the "ref" is the payload: the caller stores it directly in the row. */
export async function writeLocalImageBytes(
  _imageId: string,
  base64: string,
  _variant: ImageVariantName,
): Promise<string> {
  return base64
}

/** No-op: deleting the row deletes the bytes. */
export async function deleteLocalImageBytes(_ref: string): Promise<void> {
  return undefined
}
```

- [ ] **Step 8: Run the web test and watch it pass**

Run: `npm test -- __tests__/localImageStoreWeb.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add src/services/localImageStore.ts src/services/localImageStore.web.ts __tests__/localImageStore.test.ts __tests__/localImageStoreWeb.test.ts
git commit -m "feat(images): add platform-split localImageStore resolver seam"
```

---

## Task 6: `characterImageService` — save, cap, cascade

**Files:**
- Create: `src/services/characterImageService.ts`
- Test: `__tests__/characterImageService.test.ts` (create)

The single public write entry point. Routes on the character's `save_to_cloud` flag, inserts the row, sets it active, and enforces the 100-image FIFO cap. Cloud routing is stubbed to the local path in this task and completed in Stage B (Task 12).

**Governing rule for everything here:** never lose an image the user spent credits on. Deletion removes bytes *before* rows, so a partial failure leaves a recoverable row pointing at maybe-missing bytes — which the resolver degrades — rather than orphaned bytes nothing references.

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImageService.test.ts`:

```ts
const mockInsert = jest.fn()
const mockSetActive = jest.fn()
const mockCount = jest.fn().mockResolvedValue(0)
const mockEvictionCandidates = jest.fn().mockResolvedValue([])
const mockHardDelete = jest.fn()
const mockSoftDelete = jest.fn()
const mockGetById = jest.fn()
const mockGetActive = jest.fn().mockResolvedValue(null)
const mockGetAllForCharacter = jest.fn().mockResolvedValue([])
const mockGetCharacter = jest.fn()
const mockWriteBytes = jest.fn(async (id: string, b64: string, v: string) => `file:///doc/${id}_${v}`)
const mockDeleteBytes = jest.fn()
const mockPrepareVariants = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  insertCharacterImage: (...a: unknown[]) => mockInsert(...a),
  setActiveImageId: (...a: unknown[]) => mockSetActive(...a),
  countCharacterImages: (...a: unknown[]) => mockCount(...a),
  getEvictionCandidates: (...a: unknown[]) => mockEvictionCandidates(...a),
  hardDeleteCharacterImage: (...a: unknown[]) => mockHardDelete(...a),
  softDeleteCharacterImage: (...a: unknown[]) => mockSoftDelete(...a),
  getCharacterImageById: (...a: unknown[]) => mockGetById(...a),
  getActiveCharacterImage: (...a: unknown[]) => mockGetActive(...a),
  getAllImagesForCharacter: (...a: unknown[]) => mockGetAllForCharacter(...a),
}))
jest.mock('~/database/characterDatabase', () => ({
  getCharacter: (...a: unknown[]) => mockGetCharacter(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  writeLocalImageBytes: (...a: unknown[]) => mockWriteBytes(...(a as [string, string, string])),
  deleteLocalImageBytes: (...a: unknown[]) => mockDeleteBytes(...a),
}))
jest.mock('~/services/imageVariants', () => ({
  prepareImageVariants: (...a: unknown[]) => mockPrepareVariants(...a),
  MASTER_DIMENSION: 1024,
  THUMB_DIMENSION: 256,
}))
jest.mock('~/utilities/generateSecureUuid', () => ({
  generateSecureUuid: jest.fn(() => 'uuid-new'),
}))
jest.mock('react-native/Libraries/Utilities/Platform', () => ({ OS: 'ios', select: (o: any) => o.ios }))

import {
  saveCharacterImage,
  deleteCharacterImage,
  deleteAllImagesForCharacter,
  IMAGE_CAP_PER_CHARACTER,
} from '~/services/characterImageService'

beforeEach(() => {
  jest.clearAllMocks()
  mockCount.mockResolvedValue(0)
  mockEvictionCandidates.mockResolvedValue([])
  mockGetActive.mockResolvedValue(null)
  mockGetAllForCharacter.mockResolvedValue([])
  mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: false, cloud_id: null })
  mockPrepareVariants.mockResolvedValue({
    master: { base64: 'M64', mimeType: 'image/webp' },
    thumb: { base64: 'T64', mimeType: 'image/webp' },
  })
  mockWriteBytes.mockImplementation(async (id: string, _b: string, v: string) => `file:///doc/${id}_${v}`)
})

describe('saveCharacterImage', () => {
  it('caps at 100 images per character', () => {
    expect(IMAGE_CAP_PER_CHARACTER).toBe(100)
  })

  it('writes a file-backed row for a privacy-mode character on native', async () => {
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://src.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(row).toMatchObject({
      id: 'uuid-new',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'file',
      master_ref: 'file:///doc/uuid-new_master',
      thumb_ref: 'file:///doc/uuid-new_thumb',
      mime_type: 'image/webp',
      source: 'generated',
      sync_state: 'local',
      sync_attempts: 0,
      deleted_at: null,
    })
    expect(mockInsert).toHaveBeenCalledWith(row)
  })

  it('makes the new image active', async () => {
    await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 500, height: 500, source: 'uploaded',
    })
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'uuid-new')
  })

  it('records the mime type the encoder actually produced', async () => {
    mockPrepareVariants.mockResolvedValue({
      master: { base64: 'M64', mimeType: 'image/jpeg' },
      thumb: { base64: 'T64', mimeType: 'image/jpeg' },
    })
    const row = await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 500, height: 500, source: 'uploaded',
    })
    expect(row.mime_type).toBe('image/jpeg')
  })

  it('does not evict below the cap', async () => {
    mockCount.mockResolvedValue(50)
    await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 500, height: 500, source: 'generated',
    })
    expect(mockEvictionCandidates).not.toHaveBeenCalled()
  })

  it('evicts the oldest images once over the cap, exempting the active one', async () => {
    mockCount.mockResolvedValue(102)
    mockGetActive.mockResolvedValue({ id: 'img-active' })
    mockEvictionCandidates.mockResolvedValue([
      { id: 'old-1', storage_kind: 'file', master_ref: 'file:///a', thumb_ref: 'file:///a_t' },
    ])
    await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 500, height: 500, source: 'generated',
    })
    expect(mockEvictionCandidates).toHaveBeenCalledWith('char_a', 'img-active', 2)
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///a')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///a_t')
    expect(mockHardDelete).toHaveBeenCalledWith('old-1')
  })

  it('refuses to save against a character that does not exist', async () => {
    mockGetCharacter.mockResolvedValue(null)
    await expect(
      saveCharacterImage({
        characterId: 'nope', userId: 'user-1', uri: 'file://s.jpg',
        width: 500, height: 500, source: 'generated',
      }),
    ).rejects.toThrow(/character not found/i)
  })
})

describe('deleteCharacterImage', () => {
  it('deletes bytes before the row for a file image', async () => {
    const order: string[] = []
    mockDeleteBytes.mockImplementation(async () => { order.push('bytes') })
    mockHardDelete.mockImplementation(async () => { order.push('row') })
    mockGetById.mockResolvedValue({
      id: 'img-1', character_id: 'char_a', storage_kind: 'file',
      master_ref: 'file:///m', thumb_ref: 'file:///t',
    })
    await deleteCharacterImage('img-1', 'user-1')
    expect(order).toEqual(['bytes', 'bytes', 'row'])
  })

  it('leaves the row behind when byte deletion throws', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1', character_id: 'char_a', storage_kind: 'file',
      master_ref: 'file:///m', thumb_ref: null,
    })
    mockDeleteBytes.mockRejectedValue(new Error('disk error'))
    await expect(deleteCharacterImage('img-1', 'user-1')).rejects.toThrow('disk error')
    expect(mockHardDelete).not.toHaveBeenCalled()
  })

  it('drops the row directly for inline images — the bytes are in the row', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1', character_id: 'char_a', storage_kind: 'inline',
      master_ref: 'B64', thumb_ref: 'T64',
    })
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockDeleteBytes).not.toHaveBeenCalled()
    expect(mockHardDelete).toHaveBeenCalledWith('img-1')
  })

  it('promotes the next newest image to active when the active one is deleted', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1', character_id: 'char_a', storage_kind: 'inline', master_ref: 'B', thumb_ref: null,
    })
    mockGetActive.mockResolvedValue({ id: 'img-1' })
    mockGetAllForCharacter.mockResolvedValue([
      { id: 'img-1', deleted_at: null, created_at: 3 },
      { id: 'img-0', deleted_at: null, created_at: 2 },
    ])
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'img-0')
  })

  it('clears the active image when the last one is deleted', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1', character_id: 'char_a', storage_kind: 'inline', master_ref: 'B', thumb_ref: null,
    })
    mockGetActive.mockResolvedValue({ id: 'img-1' })
    mockGetAllForCharacter.mockResolvedValue([{ id: 'img-1', deleted_at: null, created_at: 3 }])
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockSetActive).toHaveBeenCalledWith('char_a', null)
  })

  it('is a no-op for an unknown image id', async () => {
    mockGetById.mockResolvedValue(null)
    await expect(deleteCharacterImage('gone', 'user-1')).resolves.toBeUndefined()
    expect(mockHardDelete).not.toHaveBeenCalled()
  })
})

describe('deleteAllImagesForCharacter', () => {
  it('cascades over every row including soft-deleted ones', async () => {
    mockGetAllForCharacter.mockResolvedValue([
      { id: 'a', character_id: 'char_a', storage_kind: 'file', master_ref: 'file:///a', thumb_ref: null },
      { id: 'b', character_id: 'char_a', storage_kind: 'inline', master_ref: 'B', thumb_ref: null, deleted_at: 5 },
    ])
    await deleteAllImagesForCharacter('char_a', 'user-1')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///a')
    expect(mockHardDelete).toHaveBeenCalledWith('a')
    expect(mockHardDelete).toHaveBeenCalledWith('b')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImageService.test.ts`
Expected: FAIL — `Cannot find module '~/services/characterImageService'`

- [ ] **Step 3: Implement**

Create `src/services/characterImageService.ts`:

```ts
/**
 * The only public write path for character images.
 *
 * Governing rule: never lose an image the user spent credits on. Every generated
 * image costs IMAGE_GENERATION_COST, so failures degrade (keep the local copy,
 * keep the row) rather than discard.
 */

import { getCharacter } from '~/database/characterDatabase'
import {
  countCharacterImages,
  getActiveCharacterImage,
  getAllImagesForCharacter,
  getCharacterImageById,
  getEvictionCandidates,
  hardDeleteCharacterImage,
  insertCharacterImage,
  setActiveImageId,
  type CharacterImageRow,
  type ImageSource,
} from '~/database/characterImageDatabase'
import { deleteLocalImageBytes, writeLocalImageBytes } from '~/services/localImageStore'
import { prepareImageVariants } from '~/services/imageVariants'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
import { Platform } from 'react-native'

export const IMAGE_CAP_PER_CHARACTER = 100

export interface SaveCharacterImageInput {
  characterId: string
  userId: string
  /** Source image URI — a picker result, a manipulator output, or a data: URI. */
  uri: string
  width: number
  height: number
  source: ImageSource
}

/**
 * Privacy-mode storage kind for this platform.
 *
 * Native writes files under the document directory. Web has no file system, so
 * bytes stay inline in the row — origin-private either way (see localImageStore.web).
 */
function localStorageKind(): 'file' | 'inline' {
  return Platform.OS === 'web' ? 'inline' : 'file'
}

export async function saveCharacterImage(
  input: SaveCharacterImageInput,
): Promise<CharacterImageRow> {
  const character = await getCharacter(input.characterId, input.userId)
  if (!character) {
    throw new Error(`Character not found: ${input.characterId}`)
  }

  const variants = await prepareImageVariants({
    uri: input.uri,
    width: input.width,
    height: input.height,
  })

  const imageId = generateSecureUuid()
  const kind = localStorageKind()

  // Stage B replaces this branch with a Firebase Storage upload for
  // save_to_cloud characters. Until then every image is stored locally, which
  // is strictly safe: a local row is never lost, only un-backed-up.
  const masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
  const thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')

  const row: CharacterImageRow = {
    id: imageId,
    character_id: input.characterId,
    user_id: input.userId,
    storage_kind: kind,
    master_ref: masterRef,
    thumb_ref: thumbRef,
    mime_type: variants.master.mimeType,
    source: input.source,
    sync_state: 'local',
    sync_attempts: 0,
    created_at: Date.now(),
    deleted_at: null,
  }

  await insertCharacterImage(row)
  await setActiveImageId(input.characterId, imageId)
  await enforceLocalCap(input.characterId)

  return row
}

/**
 * FIFO cap for locally-stored images.
 *
 * Cloud characters get their cap enforced server-side instead (Stage C): two
 * devices can each hold fewer than 100 while the cloud total exceeds it, so a
 * client-only cap cannot be correct there.
 */
export async function enforceLocalCap(characterId: string): Promise<void> {
  const count = await countCharacterImages(characterId)
  const excess = count - IMAGE_CAP_PER_CHARACTER
  if (excess <= 0) return

  const active = await getActiveCharacterImage(characterId)
  const candidates = await getEvictionCandidates(characterId, active?.id ?? null, excess)

  for (const candidate of candidates) {
    await removeImageBytesThenRow(candidate)
  }
}

/**
 * Bytes first, then the row.
 *
 * A failure partway leaves a row pointing at possibly-missing bytes, which the
 * resolver degrades gracefully. The reverse order would strand bytes in storage
 * with nothing left referencing them — unfindable and unbillable-for.
 */
async function removeImageBytesThenRow(row: Pick<CharacterImageRow, 'id' | 'storage_kind' | 'master_ref' | 'thumb_ref'>): Promise<void> {
  if (row.storage_kind === 'file') {
    await deleteLocalImageBytes(row.master_ref)
    if (row.thumb_ref) await deleteLocalImageBytes(row.thumb_ref)
  }
  // 'inline' needs no byte deletion — the bytes are the row.
  // 'cloud' is handled by the sync sweeper in Stage C.
  await hardDeleteCharacterImage(row.id)
}

export async function deleteCharacterImage(imageId: string, userId: string): Promise<void> {
  const row = await getCharacterImageById(imageId)
  if (!row) return
  void userId

  const active = await getActiveCharacterImage(row.character_id)
  await removeImageBytesThenRow(row)

  if (active?.id === imageId) {
    // Promote the next newest surviving image so the character never renders a
    // dangling active id; falls back to the bundled default when none remain.
    const remaining = (await getAllImagesForCharacter(row.character_id)).filter(
      (candidate) => candidate.id !== imageId && !candidate.deleted_at,
    )
    await setActiveImageId(row.character_id, remaining[0]?.id ?? null)
  }
}

/** Full cascade for character hard-delete and purge. Includes tombstoned rows. */
export async function deleteAllImagesForCharacter(
  characterId: string,
  userId: string,
): Promise<void> {
  void userId
  const rows = await getAllImagesForCharacter(characterId)
  for (const row of rows) {
    await removeImageBytesThenRow(row)
  }
  await setActiveImageId(characterId, null)
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImageService.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/characterImageService.ts __tests__/characterImageService.test.ts
git commit -m "feat(images): add characterImageService with FIFO cap and deletion cascade"
```

---

## Task 7: Bundled default avatar

**Files:**
- Create: `assets/default-avatar-1024.webp` (generated)
- Create: `scripts/build-default-avatar.mjs`
- Modify: `src/components/CharacterAvatar.tsx`
- Modify: `src/machines/characterMachine.ts:84-99`
- Delete: `src/utilities/defaultAvatarBase64.ts`, `src/utilities/loadDefaultAvatar.ts`, `src/services/defaultAvatarService.ts`
- Test: `__tests__/characterAvatarAccessibility.test.tsx` (modify)

`assets/adaptive-icon-200x200.webp` is an Android adaptive icon: the logo circle sits inside a padded square, so under a circular mask the padding renders as a ring of background colour. No `resizeMode` fixes that — the asset itself is wrong. And because `characterMachine` copies the embedded base64 into every new character's row, N characters carry N identical copies of the same 7.6 KB image.

Measured geometry of `assets/icon.png` (1024×1024): the logo circle's widest row is y=493, spanning x=19…1004 — centre (511.5, 493), diameter 986. Cropping the 986×986 square at (19, 0) and resizing to 1024 yields a circle that fills the mask edge to edge. The neck and shoulders extend below y=986 but fall outside the circular mask, so discarding them is harmless.

- [ ] **Step 1: Write the crop script**

No image tooling is installed locally — no `sharp`, ImageMagick, or PIL. Install `sharp` without persisting it to `package.json`.

Create `scripts/build-default-avatar.mjs`:

```js
/**
 * One-off: crop assets/icon.png to the logo circle and emit the bundled default avatar.
 *
 * Geometry is measured, not guessed: the circle's widest row in icon.png is
 * y=493 spanning x=19…1004, giving a 986px diameter with its left edge at x=19.
 * Run with:  npm i -D --no-save sharp && node scripts/build-default-avatar.mjs
 */
import sharp from 'sharp'

const SRC = 'assets/icon.png'
const OUT = 'assets/default-avatar-1024.webp'

const CROP = { left: 19, top: 0, width: 986, height: 986 }

const info = await sharp(SRC).metadata()
if (info.width !== 1024 || info.height !== 1024) {
  throw new Error(`Expected ${SRC} to be 1024x1024, got ${info.width}x${info.height}`)
}

await sharp(SRC)
  .extract(CROP)
  .resize(1024, 1024, { fit: 'fill' })
  .webp({ quality: 90 })
  .toFile(OUT)

const out = await sharp(OUT).metadata()
console.log(`Wrote ${OUT}: ${out.width}x${out.height} ${out.format}`)
if (out.width !== 1024 || out.height !== 1024) {
  throw new Error('Output is not 1024x1024')
}
```

- [ ] **Step 2: Generate the asset and verify its dimensions**

```bash
npm i -D --no-save sharp
node scripts/build-default-avatar.mjs
```

Expected output: `Wrote assets/default-avatar-1024.webp: 1024x1024 webp`

Then confirm it landed and is a plausible size:

```bash
ls -l assets/default-avatar-1024.webp
```

Expected: a file of roughly 20–80 KB. If the script throws on the metadata guard, `assets/icon.png` has changed since the geometry was measured — re-measure before adjusting `CROP`, do not fudge the numbers.

- [ ] **Step 3: Update the failing avatar test**

In `__tests__/characterAvatarAccessibility.test.tsx`, replace the `~/config/constants` mock at the top (lines 4-6) with a `require` stub for the asset, since `require('…webp')` returns a number under jest-expo but the component must pass it through unchanged:

```ts
jest.mock('~/config/constants', () => ({
  defaultAvatarUrl: 'https://example.com/default-avatar.png',
}))
```
becomes
```ts
jest.mock('~/config/constants', () => ({
  defaultAvatarUrl: 'https://example.com/default-avatar.png',
}))

jest.mock('../assets/default-avatar-1024.webp', () => 'DEFAULT_AVATAR_ASSET', { virtual: true })
```

Then append these cases to the existing `describe('CharacterAvatar accessibility')` block:

```ts
  it('falls back to the bundled default asset when there is no image and no name', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="" showFallback={false} />) })
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.source).toBe('DEFAULT_AVATAR_ASSET')
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })

  it('falls back to the bundled default after the remote image errors', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl="https://example.com/a.png" characterName="" showFallback={false} />) })
    act(() => { tree.root.findByType('AvatarImage').props.onError() })
    expect(tree.root.findByType('AvatarImage').props.source).toBe('DEFAULT_AVATAR_ASSET')
  })

  it('covers rather than letterboxes non-square images', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl="https://example.com/wide.png" characterName="Frodo" />) })
    expect(tree.root.findByType('AvatarImage').props.resizeMode).toBe('cover')
  })
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `npm test -- __tests__/characterAvatarAccessibility.test.tsx`
Expected: FAIL — the default-asset cases fail because the component still renders `Avatar.Icon` / the gravatar URL, and `resizeMode` is undefined.

- [ ] **Step 5: Rewrite `CharacterAvatar`**

Replace the whole of `src/components/CharacterAvatar.tsx`:

```tsx
import React, { useEffect, useState } from 'react'
import { Avatar } from 'react-native-paper'

/**
 * Bundled default. Nothing is written per character: previously every new
 * character stored its own copy of the same 7.6 KB base64 blob, and that blob
 * was an Android adaptive icon whose padding showed as a ring under the
 * circular mask.
 */
const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')

interface CharacterAvatarProps {
  size?: number
  imageUrl?: string | null
  characterName?: string
  showFallback?: boolean
}

export default function CharacterAvatar({
  size = 100,
  imageUrl,
  characterName = '',
  showFallback = true,
}: CharacterAvatarProps) {
  const [imageError, setImageError] = useState(false)

  // A new URI is a new attempt: without this, one failed load would pin the
  // fallback for the lifetime of the component even after the user picks
  // another image.
  useEffect(() => {
    setImageError(false)
  }, [imageUrl])

  if (imageUrl && !imageError) {
    return (
      <Avatar.Image
        size={size}
        source={{ uri: imageUrl }}
        // Legacy migrated avatars can be non-square; cover fills the circle
        // instead of letterboxing it.
        resizeMode="cover"
        onError={() => setImageError(true)}
        accessible
        accessibilityLabel={characterName ? `${characterName} avatar` : 'Character avatar'}
      />
    )
  }

  if (characterName && showFallback) {
    const initials = characterName
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase()

    if (initials) {
      return (
        <Avatar.Text
          size={size}
          label={initials}
          accessible
          accessibilityLabel={`${characterName} avatar`}
        />
      )
    }
  }

  return (
    <Avatar.Image
      size={size}
      source={DEFAULT_AVATAR}
      resizeMode="cover"
      accessible
      accessibilityLabel="Character avatar"
    />
  )
}
```

Note the removed `Avatar.Icon` branch: the bundled default is now the single final fallback, so the `showFallback={false}` path and the gravatar URL both collapse into it.

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm test -- __tests__/characterAvatarAccessibility.test.tsx`
Expected: PASS. If a pre-existing case asserted on `AvatarIcon`, update it to expect the default `AvatarImage` — that branch no longer exists.

- [ ] **Step 7: Stop writing a default avatar into every character**

In `src/machines/characterMachine.ts`, delete the import of `loadDefaultAvatarBase64` and replace the avatar-loading block inside `createDefaultCharacterActor` (the `let normalizedAvatarData` declaration through `const characterWithAvatar: CharacterInsert = {...}`) with:

```ts
    // No avatar row is written: characters with no active image fall through to
    // the bundled default in CharacterAvatar.
    const newCharacter = await createCharacterDb(input.userId, DEFAULT_CHARACTER_INSERT)
```

and delete the now-dangling `if (!newCharacter)`-preceding lines that referenced `characterWithAvatar`. Keep the existing `if (!newCharacter) throw …` guard and `return newCharacter`.

- [ ] **Step 8: Delete the dead default-avatar sources**

```bash
git rm src/utilities/defaultAvatarBase64.ts src/utilities/loadDefaultAvatar.ts src/services/defaultAvatarService.ts
```

- [ ] **Step 9: Verify nothing still references them**

Run: `grep -rn "defaultAvatarBase64\|loadDefaultCharacterAvatar\|loadDefaultAvatarBase64\|adaptive-icon-200x200" src app __tests__`
Expected: no output. Any hit is a reference that must be removed before proceeding (check `__tests__/characterMachine.test.ts` in particular — its mock of `~/services/defaultAvatarService` must go).

- [ ] **Step 10: Run the affected suites and typecheck**

Run: `npm test -- __tests__/characterMachine.test.ts __tests__/characterAvatarAccessibility.test.tsx __tests__/characterCardAccessibility.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors. A missing declaration for the `.webp` import means `expo-env.d.ts` is not being picked up — confirm `tsconfig.json` still includes it rather than adding a new ambient module.

- [ ] **Step 11: Commit**

```bash
git add assets/default-avatar-1024.webp scripts/build-default-avatar.mjs src/components/CharacterAvatar.tsx src/machines/characterMachine.ts __tests__/characterAvatarAccessibility.test.tsx
git commit -m "feat(avatar): bundle a borderless default avatar and stop copying it per character"
```

---

## Task 8: `useResolvedImage` and consumer rewiring

**Files:**
- Create: `src/hooks/useResolvedImage.ts`
- Modify: `src/database/characterDatabase.ts:69-97` (`toAppFormat`)
- Modify: `src/components/CharacterCard.tsx`
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`
- Test: `__tests__/useResolvedImage.test.tsx` (create)

`CharacterAvatar` keeps its `imageUrl?: string` prop untouched — resolution moves into a hook its consumers call. That preserves the component and its accessibility tests exactly as they are.

- [ ] **Step 1: Write the failing test**

Create `__tests__/useResolvedImage.test.tsx`:

```tsx
import React from 'react'
import { act, create } from 'react-test-renderer'
import { useResolvedImage } from '~/hooks/useResolvedImage'

const mockGetById = jest.fn()
const mockResolve = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getCharacterImageById: (...a: unknown[]) => mockGetById(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: (...a: unknown[]) => mockResolve(...a),
}))

function Probe({ imageId, variant }: { imageId: string | null; variant: 'master' | 'thumb' }) {
  const uri = useResolvedImage(imageId, variant)
  return <probe uri={uri} /> as never
}

async function render(imageId: string | null, variant: 'master' | 'thumb' = 'master') {
  let tree: any
  await act(async () => { tree = create(<Probe imageId={imageId} variant={variant} />) })
  await act(async () => { await Promise.resolve() })
  return tree
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetById.mockResolvedValue({ id: 'img-1', storage_kind: 'inline', master_ref: 'M', mime_type: 'image/webp' })
  mockResolve.mockResolvedValue('data:image/webp;base64,M')
})

describe('useResolvedImage', () => {
  it('returns null while nothing is requested', async () => {
    const tree = await render(null)
    expect(tree.root.findByType('probe').props.uri).toBeNull()
    expect(mockGetById).not.toHaveBeenCalled()
  })

  it('resolves the row for the requested variant', async () => {
    const tree = await render('img-1', 'thumb')
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'img-1' }), 'thumb')
    expect(tree.root.findByType('probe').props.uri).toBe('data:image/webp;base64,M')
  })

  it('yields null when the row is gone', async () => {
    mockGetById.mockResolvedValue(null)
    const tree = await render('missing')
    expect(tree.root.findByType('probe').props.uri).toBeNull()
  })

  it('yields null instead of throwing when resolution fails', async () => {
    mockResolve.mockRejectedValue(new Error('offline'))
    const tree = await render('img-1')
    expect(tree.root.findByType('probe').props.uri).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/useResolvedImage.test.tsx`
Expected: FAIL — `Cannot find module '~/hooks/useResolvedImage'`

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useResolvedImage.ts`:

```ts
import { useEffect, useState } from 'react'
import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'

export type ImageVariantName = 'master' | 'thumb'

/**
 * Resolve a `character_images` row id to a renderable URI.
 *
 * Returns null rather than throwing on any failure: CharacterAvatar's own
 * fallback chain (master → thumb → bundled default) is the recovery path, and a
 * throwing hook would take the whole screen down for a missing thumbnail.
 */
export function useResolvedImage(
  imageId: string | null | undefined,
  variant: ImageVariantName = 'master',
): string | null {
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!imageId) {
      setUri(null)
      return () => { cancelled = true }
    }

    void (async () => {
      try {
        const row = await getCharacterImageById(imageId)
        if (cancelled) return
        if (!row) {
          setUri(null)
          return
        }
        const resolved = await resolveImageUri(row, variant)
        if (!cancelled) setUri(resolved)
      } catch (err) {
        console.warn('Failed to resolve character image:', imageId, variant, err)
        if (!cancelled) setUri(null)
      }
    })()

    return () => { cancelled = true }
  }, [imageId, variant])

  return uri
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/useResolvedImage.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Stop building a data URI in `toAppFormat`**

In `src/database/characterDatabase.ts`, delete the `displayAvatar` computation (lines 70-73) and the now-unused `sanitizeImageMimeType` import (line 8). In the returned object, replace `avatar: displayAvatar,` with:

```ts
        avatar: char.avatar,
        active_image_id: char.active_image_id ?? null,
```

Add `active_image_id: string | null` to the `LocalCharacter` interface (after `voice: string`).

The `avatar` column is the deprecated cloud URL (§3.3); it keeps syncing untouched for one release so a rollback has somewhere to land, but nothing reads it for display any more.

- [ ] **Step 6: Route `CharacterCard` through the hook**

In `src/components/CharacterCard.tsx`:

Add the import:
```tsx
import { useResolvedImage } from '~/hooks/useResolvedImage'
```

Change the props interface — replace `avatar?: string` with:
```tsx
  activeImageId?: string | null
```

Inside the component, replace the destructured `avatar,` with `activeImageId,` and add, just above `const theme = useTheme()`:
```tsx
  // Thumb, not master: this renders at 48px, and the list can hold many cards.
  const avatarUri = useResolvedImage(activeImageId, 'thumb')
```

Change the avatar render to:
```tsx
                <CharacterAvatar size={48} imageUrl={avatarUri} characterName={name} />
```

- [ ] **Step 7: Update every `CharacterCard` call site**

Run: `grep -rn "<CharacterCard" app src`

For each hit, replace the `avatar={…}` prop with `activeImageId={character.active_image_id}` (matching whatever the local variable for the character is named at that site).

- [ ] **Step 8: Route the edit screen through the hook**

In `app/(drawer)/(tabs)/characters/[id]/edit.tsx`:

Add the import next to the other hook imports:
```tsx
import { useResolvedImage } from '~/hooks/useResolvedImage'
```

Replace the `avatarUri` state (line 63) with:
```tsx
  const [activeImageId, setActiveImageId] = useState<string | null>(null)
  const avatarUri = useResolvedImage(activeImageId, 'master')
```

Replace the load line (line 173) `setAvatarUri(character.avatar ?? null)` with:
```tsx
      setActiveImageId(character.active_image_id ?? null)
```

- [ ] **Step 9: Run the suite and typecheck**

Run: `npm test -- __tests__/characterCardAccessibility.test.tsx __tests__/editCharacterScreen.test.tsx __tests__/characterDatabaseBatchInsert.test.ts`
Expected: PASS. Update any test still passing an `avatar` prop to `CharacterCard` to pass `activeImageId` instead.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useResolvedImage.ts src/database/characterDatabase.ts src/components/CharacterCard.tsx "app/(drawer)/(tabs)/characters/[id]/edit.tsx" __tests__/useResolvedImage.test.tsx
git commit -m "feat(images): resolve avatars through useResolvedImage instead of avatar_data"
```

---

## Task 9: Upload and generate route through the gallery

**Files:**
- Modify: `src/hooks/useAvatarUpload.ts`
- Modify: `src/hooks/useImageGeneration.ts`
- Delete: `src/services/localImageStorageService.ts`
- Test: `__tests__/useAvatarUpload.test.tsx` (modify)

Two behaviour changes. **Uploads become square:** `allowsEditing: true, aspect: [1, 1]` gives the user their own crop — iOS always presents a square cropper when editing is on, `aspect` drives Android, and web (which does not support `allowsEditing`) gets a programmatic centre-crop. This reverses the original `allowsEditing: false`, which was right when avatars were incidental and is wrong now that filling the circle is a requirement. **Both paths stop destroying history:** `saveCharacterImageLocally` wrote a single column, so every new avatar — including uploads — silently replaced the previous one.

- [ ] **Step 1: Update the failing upload test**

In `__tests__/useAvatarUpload.test.tsx`, replace the `~/services/localImageStorageService` mock (lines 24-26) with:

```ts
jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: jest.fn(),
}))
jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
  appCheckReady: Promise.resolve(),
}))
```

Replace the corresponding import (line 4) and handle (line 36):

```ts
import { saveCharacterImage } from '~/services/characterImageService'
```
```ts
const mockSaveCharacterImage = jest.mocked(saveCharacterImage)
```

Then update every existing assertion on `mockSaveCharacterImageLocally` to `mockSaveCharacterImage`, and add these cases:

```ts
  it('requests a square crop from the picker', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(2000, 1000))
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' } as never)
    await act(async () => { await hookRef.uploadAvatar() })
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsEditing: true, aspect: [1, 1] }),
    )
  })

  it('routes the upload into the gallery as source "uploaded"', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(1024, 1024))
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-1' } as never)
    await act(async () => { await hookRef.uploadAvatar() })
    expect(mockSaveCharacterImage).toHaveBeenCalledWith({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file://source.jpg',
      width: 1024,
      height: 1024,
      source: 'uploaded',
    })
  })

  it('returns the new image id so the caller can activate it', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(1024, 1024))
    mockSaveCharacterImage.mockResolvedValue({ id: 'img-42' } as never)
    let result: string | null = null
    await act(async () => { result = await hookRef.uploadAvatar() })
    expect(result).toBe('img-42')
  })

  it('still rejects images below the 200px minimum', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue(makePickerResult(150, 150))
    await act(async () => { await hookRef.uploadAvatar() })
    expect(mockSaveCharacterImage).not.toHaveBeenCalled()
    expect(hookRef.error).toMatch(/minimum size is 200/i)
  })
```

Adapt `hookRef` to however the existing file exposes the hook's return value. The `afterEach` block asserting `file.delete()` was called must be **removed** — temp-file cleanup now lives in `prepareImageVariants` (Task 4), which this hook no longer drives.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/useAvatarUpload.test.tsx`
Expected: FAIL — `allowsEditing` is `false` and `saveCharacterImage` is never called.

- [ ] **Step 3: Rewrite `useAvatarUpload`**

Replace `src/hooks/useAvatarUpload.ts`:

```ts
import { useState } from 'react'
import { Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync } from 'expo-image-manipulator'
import { useCharacterMachine } from '~/hooks/useMachines'
import { getCurrentUser } from '~/config/firebaseConfig'
import { saveCharacterImage } from '~/services/characterImageService'
import { getEncodeTarget } from '~/utilities/webpSupport'

interface UseAvatarUploadProps {
  characterId: string
  /** Receives the new `character_images` row id. */
  onImageUploaded?: (imageId: string) => void
}

interface UseAvatarUploadReturn {
  uploadAvatar: () => Promise<string | null>
  isUploading: boolean
  error: string | null
  clearError: () => void
}

const MIN_IMAGE_DIMENSION = 200

/**
 * Web has no native cropper (`allowsEditing` is a no-op there), so square it
 * ourselves by taking the largest centred square. Native returns an
 * already-square asset from the OS cropper and skips this entirely.
 */
async function centreCropToSquare(uri: string, width: number, height: number) {
  if (width === height) return { uri, width, height }

  const side = Math.min(width, height)
  const { format } = getEncodeTarget()
  const cropped = await manipulateAsync(
    uri,
    [{ crop: {
      originX: Math.floor((width - side) / 2),
      originY: Math.floor((height - side) / 2),
      width: side,
      height: side,
    } }],
    { format, compress: 1 },
  )
  return { uri: cropped.uri, width: side, height: side }
}

export function useAvatarUpload({
  characterId,
  onImageUploaded,
}: UseAvatarUploadProps): UseAvatarUploadReturn {
  const characterService = useCharacterMachine()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = () => setError(null)

  const uploadAvatar = async (): Promise<string | null> => {
    setIsUploading(true)
    setError(null)

    try {
      const userId = getCurrentUser()?.uid
      if (!userId) throw new Error('You must be signed in to upload an image')

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        // The user picks their own crop, and the result is guaranteed square:
        // iOS always shows a square cropper when editing is on, and `aspect`
        // drives Android. Previously a 16:9 photo became 1024×576 and the
        // circular mask cropped an arbitrary slice nobody chose.
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      })

      if (pickerResult.canceled) return null

      const [asset] = pickerResult.assets
      if (!asset) throw new Error('No image selected')

      const { uri: sourceUri, width, height } = asset

      if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
        throw new Error('Image too small. Minimum size is 200×200 pixels.')
      }

      const square = Platform.OS === 'web'
        ? await centreCropToSquare(sourceUri, width, height)
        : { uri: sourceUri, width, height }

      const row = await saveCharacterImage({
        characterId,
        userId,
        uri: square.uri,
        width: square.width,
        height: square.height,
        source: 'uploaded',
      })

      characterService.send({ type: 'LOAD' })
      onImageUploaded?.(row.id)
      return row.id
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload image'
      setError(message.toLowerCase().includes('permission') ? 'Photo library access denied' : message)
      return null
    } finally {
      setIsUploading(false)
    }
  }

  return { uploadAvatar, isUploading, error, clearError }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/useAvatarUpload.test.tsx`
Expected: PASS.

- [ ] **Step 5: Route generation through the gallery too**

In `src/hooks/useImageGeneration.ts`:

Replace the `saveCharacterImageLocally` import with:
```ts
import { getCurrentUser } from '~/config/firebaseConfig'
import { saveCharacterImage } from '~/services/characterImageService'
```

Change the callback prop type on line 9 to `onImageGenerated?: (imageId: string) => void` and the return type on line 14 to `generateImage: (prompt: string) => Promise<string | null>` (unchanged shape, now carrying an image id).

Replace the save block (lines 46-51) with:

```ts
      const generated = await generateImageViaCallable(prompt)

      const userId = getCurrentUser()?.uid
      if (!userId) throw new Error('You must be signed in to generate an image')

      // generateImage itself is unchanged — the model returns base64 and the
      // client decides where it lands. Vision reuses this same seam later.
      const row = await saveCharacterImage({
        characterId,
        userId,
        uri: `data:${generated.mimeType};base64,${generated.imageBase64}`,
        width: 1024,
        height: 1024,
        source: 'generated',
      })
```

Replace the two later uses of `dataUri` (lines 70-71) with:
```ts
      onImageGenerated?.(row.id)
      return row.id
```

- [ ] **Step 6: Delete the superseded single-column service**

```bash
git rm src/services/localImageStorageService.ts
```

- [ ] **Step 7: Verify no references remain and typecheck**

Run: `grep -rn "localImageStorageService\|saveCharacterImageLocally\|getLocalCharacterImageUri\|deleteLocalCharacterImage" src app __tests__`
Expected: no output.

Run: `npm run typecheck`
Expected: no errors. The edit screen's `onImageGenerated` / `onImageUploaded` handlers now receive an image id — point them at `setActiveImageId` from Task 8.

- [ ] **Step 8: Run the app-level suites**

Run: `npm test -- __tests__/useAvatarUpload.test.tsx __tests__/editCharacterScreen.test.tsx __tests__/imageGenerationService.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useAvatarUpload.ts src/hooks/useImageGeneration.ts __tests__/useAvatarUpload.test.tsx "app/(drawer)/(tabs)/characters/[id]/edit.tsx"
git commit -m "feat(images): square uploads and route generate/upload through the gallery"
```

---

## Task 10: Avatar picker modal

**Files:**
- Create: `src/components/AvatarPicker.tsx`
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`
- Test: `__tests__/avatarPicker.test.tsx` (create)

A `FlatList numColumns={3}` of thumbs, newest first, the active one check-marked. Tap activates; long-press deletes. The Generate and Upload buttons move into its header, reusing `useImageGeneration` and `useAvatarUpload` unchanged.

- [ ] **Step 1: Write the failing test**

Create `__tests__/avatarPicker.test.tsx`:

```tsx
import React from 'react'
import { act, create } from 'react-test-renderer'

const mockGetImages = jest.fn()
const mockSetActive = jest.fn()
const mockDeleteImage = jest.fn()
const mockUploadAvatar = jest.fn()
const mockGenerateImage = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getCharacterImages: (...a: unknown[]) => mockGetImages(...a),
  setActiveImageId: (...a: unknown[]) => mockSetActive(...a),
}))
jest.mock('~/services/characterImageService', () => ({
  deleteCharacterImage: (...a: unknown[]) => mockDeleteImage(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: jest.fn(async (row: any) => `resolved:${row.id}`),
}))
jest.mock('~/hooks/useAvatarUpload', () => ({
  useAvatarUpload: () => ({ uploadAvatar: mockUploadAvatar, isUploading: false, error: null, clearError: jest.fn() }),
}))
jest.mock('~/hooks/useImageGeneration', () => ({
  useImageGeneration: () => ({ generateImage: mockGenerateImage, isGenerating: false, error: null, clearError: jest.fn() }),
}))
jest.mock('~/hooks/useMachines', () => ({ useCharacterMachine: () => ({ send: jest.fn() }) }))

import { AvatarPicker } from '~/components/AvatarPicker'

const rows = [
  { id: 'img-2', character_id: 'char_a', storage_kind: 'inline', master_ref: 'M2', thumb_ref: 'T2', mime_type: 'image/webp', created_at: 2, deleted_at: null },
  { id: 'img-1', character_id: 'char_a', storage_kind: 'inline', master_ref: 'M1', thumb_ref: 'T1', mime_type: 'image/webp', created_at: 1, deleted_at: null },
]

async function renderPicker(props: Partial<React.ComponentProps<typeof AvatarPicker>> = {}) {
  let tree: any
  await act(async () => {
    tree = create(
      <AvatarPicker
        visible
        characterId="char_a"
        activeImageId="img-2"
        imagePrompt="a knight"
        onDismiss={jest.fn()}
        onActiveImageChange={jest.fn()}
        {...props}
      />,
    )
  })
  await act(async () => { await Promise.resolve() })
  return tree
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetImages.mockResolvedValue(rows)
})

describe('AvatarPicker', () => {
  it('lists every live image newest first', async () => {
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    expect(items.map((i: any) => i.props.accessibilityLabel)).toEqual([
      'Avatar 1 of 2, selected',
      'Avatar 2 of 2',
    ])
  })

  it('activates the tapped image and reports it upward', async () => {
    const onActiveImageChange = jest.fn()
    const tree = await renderPicker({ onActiveImageChange })
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    await act(async () => { await items[1].props.onPress() })
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'img-1')
    expect(onActiveImageChange).toHaveBeenCalledWith('img-1')
  })

  it('deletes on long press and refreshes the list', async () => {
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    mockGetImages.mockResolvedValue([rows[0]])
    await act(async () => { await items[1].props.onLongPress() })
    expect(mockDeleteImage).toHaveBeenCalledWith('img-1', expect.anything())
    expect(mockGetImages).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when the character has no images', async () => {
    mockGetImages.mockResolvedValue([])
    const tree = await renderPicker()
    expect(tree.root.findAllByProps({ testID: 'avatar-picker-empty' }).length).toBeGreaterThan(0)
  })

  it('generates from the header using the supplied prompt', async () => {
    const tree = await renderPicker()
    const button = tree.root.findByProps({ testID: 'avatar-picker-generate' })
    await act(async () => { await button.props.onPress() })
    expect(mockGenerateImage).toHaveBeenCalledWith('a knight')
  })

  it('uploads from the header', async () => {
    const tree = await renderPicker()
    const button = tree.root.findByProps({ testID: 'avatar-picker-upload' })
    await act(async () => { await button.props.onPress() })
    expect(mockUploadAvatar).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/avatarPicker.test.tsx`
Expected: FAIL — `Cannot find module '~/components/AvatarPicker'`

- [ ] **Step 3: Implement**

Create `src/components/AvatarPicker.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react'
import { FlatList, Image, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Button, Dialog, HelperText, Icon, Portal, Text } from 'react-native-paper'
import { getCurrentUser } from '~/config/firebaseConfig'
import {
  getCharacterImages,
  setActiveImageId,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { deleteCharacterImage } from '~/services/characterImageService'
import { resolveImageUri } from '~/services/localImageStore'
import { useAvatarUpload } from '~/hooks/useAvatarUpload'
import { useImageGeneration } from '~/hooks/useImageGeneration'

interface AvatarPickerProps {
  visible: boolean
  characterId: string
  activeImageId: string | null
  /** Prompt handed to generation when the user taps Generate. */
  imagePrompt: string
  onDismiss: () => void
  onActiveImageChange: (imageId: string | null) => void
}

interface PickerItem {
  row: CharacterImageRow
  uri: string | null
}

export function AvatarPicker({
  visible,
  characterId,
  activeImageId,
  imagePrompt,
  onDismiss,
  onActiveImageChange,
}: AvatarPickerProps) {
  const [items, setItems] = useState<PickerItem[]>([])

  const refresh = useCallback(async () => {
    const rows = await getCharacterImages(characterId)
    // Resolve thumbs, not masters: 100 masters is a ~15 MB screen, 100 thumbs
    // is ~1.2 MB — and on web every byte crosses the WASM boundary.
    const resolved = await Promise.all(
      rows.map(async (row) => {
        try {
          return { row, uri: await resolveImageUri(row, 'thumb') }
        } catch {
          return { row, uri: null }
        }
      }),
    )
    setItems(resolved)
  }, [characterId])

  useEffect(() => {
    if (visible) void refresh()
  }, [visible, refresh])

  const { uploadAvatar, isUploading, error: uploadError, clearError: clearUploadError } =
    useAvatarUpload({ characterId, onImageUploaded: (id) => { onActiveImageChange(id); void refresh() } })

  const { generateImage, isGenerating, error: generateError, clearError: clearGenerateError } =
    useImageGeneration({ characterId, onImageGenerated: (id) => { onActiveImageChange(id); void refresh() } })

  const handleActivate = async (imageId: string) => {
    await setActiveImageId(characterId, imageId)
    onActiveImageChange(imageId)
    await refresh()
  }

  const handleDelete = async (imageId: string) => {
    const userId = getCurrentUser()?.uid
    await deleteCharacterImage(imageId, userId ?? '')
    if (imageId === activeImageId) {
      const remaining = await getCharacterImages(characterId)
      onActiveImageChange(remaining[0]?.id ?? null)
    }
    await refresh()
  }

  const error = uploadError || generateError

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title>Choose avatar</Dialog.Title>
        <Dialog.Content>
          <View style={styles.headerActions}>
            <Button
              testID="avatar-picker-upload"
              mode="outlined"
              icon={isUploading ? undefined : 'image-plus'}
              loading={isUploading}
              disabled={isUploading || isGenerating}
              onPress={() => { clearUploadError(); clearGenerateError(); return uploadAvatar() }}
              style={styles.headerButton}
            >
              Upload
            </Button>
            <Button
              testID="avatar-picker-generate"
              mode="outlined"
              icon={isGenerating ? undefined : 'image-auto-adjust'}
              loading={isGenerating}
              disabled={isUploading || isGenerating}
              onPress={() => { clearUploadError(); clearGenerateError(); return generateImage(imagePrompt) }}
              style={styles.headerButton}
            >
              Generate
            </Button>
          </View>

          {error ? <HelperText type="error" visible>{error}</HelperText> : null}

          {items.length === 0 ? (
            <Text testID="avatar-picker-empty" style={styles.empty}>
              No images yet. Upload a photo or generate one.
            </Text>
          ) : (
            <FlatList
              data={items}
              numColumns={3}
              keyExtractor={(item) => item.row.id}
              renderItem={({ item, index }) => {
                const selected = item.row.id === activeImageId
                return (
                  <TouchableOpacity
                    testID="avatar-picker-item"
                    style={styles.tile}
                    onPress={() => handleActivate(item.row.id)}
                    onLongPress={() => handleDelete(item.row.id)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      `Avatar ${index + 1} of ${items.length}${selected ? ', selected' : ''}`
                    }
                    accessibilityHint="Tap to use this avatar, long press to delete it"
                  >
                    {item.uri ? (
                      <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbMissing]} />
                    )}
                    {selected ? (
                      <View style={styles.check}>
                        <Icon source="check-circle" size={20} />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                )
              }}
            />
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Done</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  )
}

const styles = StyleSheet.create({
  dialog: { maxHeight: '80%' },
  headerActions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  headerButton: { flex: 1 },
  empty: { textAlign: 'center', opacity: 0.7, paddingVertical: 24 },
  tile: { flex: 1 / 3, aspectRatio: 1, padding: 4 },
  thumb: { width: '100%', height: '100%', borderRadius: 8 },
  thumbMissing: { backgroundColor: 'rgba(127,127,127,0.2)' },
  check: { position: 'absolute', right: 6, bottom: 6 },
})

export default AvatarPicker
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/avatarPicker.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 4b: Surface rows that are not backed up**

§13.1 stops retrying a row after the budget is exhausted, and the reason unbounded retry was rejected is that it *buries the one signal telling the user cloud backup is not happening*. The picker is where that signal belongs, so add it now rather than leaving `failed` invisible.

Add the test first, to `__tests__/avatarPicker.test.tsx`:

```tsx
  it('marks images that failed to back up', async () => {
    mockGetImages.mockResolvedValue([
      { ...rows[0], sync_state: 'failed' },
      { ...rows[1], sync_state: 'synced' },
    ])
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    expect(items[0].props.accessibilityLabel).toContain('not backed up')
    expect(items[1].props.accessibilityLabel).not.toContain('not backed up')
  })

  it('does not mark a privacy-mode image as un-backed-up', async () => {
    mockGetImages.mockResolvedValue([{ ...rows[0], sync_state: 'local' }])
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })
    expect(items[0].props.accessibilityLabel).not.toContain('not backed up')
  })
```

Run it: `npm test -- __tests__/avatarPicker.test.tsx` — expect FAIL.

Then in `AvatarPicker.tsx`, inside `renderItem`, add above the `return`:

```tsx
                // 'local' is the privacy-mode terminal state, NOT a failure —
                // only rows that tried and could not reach the cloud are flagged.
                const notBackedUp = item.row.sync_state === 'failed'
```

extend the label:

```tsx
                    accessibilityLabel={
                      `Avatar ${index + 1} of ${items.length}` +
                      `${selected ? ', selected' : ''}` +
                      `${notBackedUp ? ', not backed up' : ''}`
                    }
```

and render a badge next to the check:

```tsx
                    {notBackedUp ? (
                      <View style={styles.warning}>
                        <Icon source="cloud-off-outline" size={16} />
                      </View>
                    ) : null}
```

with the style `warning: { position: 'absolute', left: 6, bottom: 6 }`.

Run it again: PASS.

- [ ] **Step 5: Wire the picker into the edit screen**

In `app/(drawer)/(tabs)/characters/[id]/edit.tsx`:

Add the import:
```tsx
import { AvatarPicker } from '~/components/AvatarPicker'
```

Add state next to `activeImageId`:
```tsx
  const [pickerVisible, setPickerVisible] = useState(false)
```

Replace the two avatar action `<Button>`s (the Upload Photo / Generate Image pair, lines ~456-484) with a single button that opens the picker:

```tsx
              <Button
                mode="outlined"
                icon="image-multiple"
                onPress={() => setPickerVisible(true)}
                disabled={!canEdit}
                style={styles.avatarActionButton}
              >
                Change Image
              </Button>
```

Delete the now-unused `useImageGeneration` / `useAvatarUpload` hook calls and the `avatarError` HelperText from this screen — both moved into the picker. Render the picker as a sibling of the Snackbar near the end of the component:

```tsx
      <AvatarPicker
        visible={pickerVisible}
        characterId={id}
        activeImageId={activeImageId}
        imagePrompt={buildImagePrompt({ name, appearance, traits, emotions })}
        onDismiss={() => setPickerVisible(false)}
        onActiveImageChange={setActiveImageId}
      />
```

- [ ] **Step 6: Run the screen test and typecheck**

Run: `npm test -- __tests__/editCharacterScreen.test.tsx`
Expected: PASS. Assertions targeting the removed "Upload Photo" / "Generate Image" buttons must be retargeted at "Change Image" plus the picker's own buttons.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/AvatarPicker.tsx __tests__/avatarPicker.test.tsx "app/(drawer)/(tabs)/characters/[id]/edit.tsx"
git commit -m "feat(images): add avatar picker modal with gallery, activate and delete"
```

---

## Task 11: Migrate existing `avatar_data` into the gallery

**Files:**
- Create: `src/database/migrations/migrateAvatarsToImageStore.ts`
- Modify: `app/_layout.tsx`
- Test: `__tests__/migrateAvatarsToImageStore.test.ts` (create)

DDL lives in migrations 22 and 23. The **data move runs in JS** because it needs conditional logic SQL cannot express cleanly: recognising the bundled default, sniffing actual image formats, and re-encoding mislabelled rows.

`avatar_data` is **left in place and unread for one release** as a rollback net, then dropped in a follow-up alongside the Postgres `characters.avatar` column.

- [ ] **Step 1: Write the failing test**

Create `__tests__/migrateAvatarsToImageStore.test.ts`:

```ts
const mockGetAllAsync = jest.fn()
const mockRunAsync = jest.fn()
const mockStorageGet = jest.fn()
const mockStorageSet = jest.fn()
const mockInsert = jest.fn()
const mockSetActive = jest.fn()
const mockGetImages = jest.fn().mockResolvedValue([])
const mockUpdateRefs = jest.fn()
const mockPrepareVariants = jest.fn()

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(async () => ({
    getAllAsync: mockGetAllAsync,
    runAsync: mockRunAsync,
  })),
}))
jest.mock('~/utilities/kvStorage', () => ({
  Storage: {
    getItem: (...a: unknown[]) => mockStorageGet(...a),
    setItem: (...a: unknown[]) => mockStorageSet(...a),
  },
}))
jest.mock('~/database/characterImageDatabase', () => ({
  insertCharacterImage: (...a: unknown[]) => mockInsert(...a),
  setActiveImageId: (...a: unknown[]) => mockSetActive(...a),
  getCharacterImages: (...a: unknown[]) => mockGetImages(...a),
  updateImageRefs: (...a: unknown[]) => mockUpdateRefs(...a),
}))
jest.mock('~/services/imageVariants', () => ({
  prepareImageVariants: (...a: unknown[]) => mockPrepareVariants(...a),
}))
jest.mock('~/utilities/generateSecureUuid', () => ({
  generateSecureUuid: jest.fn(() => 'uuid-mig'),
}))

import {
  migrateAvatarsToImageStore,
  sniffImageMimeType,
  AVATAR_MIGRATION_FLAG,
} from '../src/database/migrations/migrateAvatarsToImageStore'

// Real prefix of the bundled default that shipped in commit bf9d2f66.
const DEFAULT_B64 = 'UklGRDEAAABXRUJQVlA4DEFAULTDEFAULT'

function charRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'char_a',
    user_id: 'user-1',
    avatar_data: 'UklGRkkAAABXRUJQVlA4CUSTOM',
    avatar_mime_type: 'image/webp',
    save_to_cloud: 0,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStorageGet.mockResolvedValue(null)
  mockGetImages.mockResolvedValue([])
  mockPrepareVariants.mockResolvedValue({
    master: { base64: 'NEWM', mimeType: 'image/webp' },
    thumb: { base64: 'NEWT', mimeType: 'image/webp' },
  })
})

describe('sniffImageMimeType', () => {
  it('recognises WebP by its RIFF prefix', () => {
    expect(sniffImageMimeType('UklGRkkAAABXRUJQ')).toBe('image/webp')
  })
  it('recognises PNG', () => {
    expect(sniffImageMimeType('iVBORw0KGgoAAAANSUhEUg')).toBe('image/png')
  })
  it('recognises JPEG', () => {
    expect(sniffImageMimeType('/9j/4AAQSkZJRg')).toBe('image/jpeg')
  })
  it('falls back to WebP for unrecognised bytes', () => {
    expect(sniffImageMimeType('zzzz')).toBe('image/webp')
  })
})

describe('migrateAvatarsToImageStore', () => {
  it('skips entirely once the flag is set', async () => {
    mockStorageGet.mockResolvedValue('done')
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockGetAllAsync).not.toHaveBeenCalled()
  })

  it('sets the flag when it completes', async () => {
    mockGetAllAsync.mockResolvedValue([])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockStorageSet).toHaveBeenCalledWith(AVATAR_MIGRATION_FLAG, 'done')
  })

  it('gives characters holding the bundled default no image row at all', async () => {
    mockGetAllAsync.mockResolvedValue([charRow({ avatar_data: DEFAULT_B64 })])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it('compares against the default by strict equality, not by length alone', async () => {
    const sameLengthDifferentBytes = 'X'.repeat(DEFAULT_B64.length)
    mockGetAllAsync.mockResolvedValue([charRow({ avatar_data: sameLengthDifferentBytes })])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).toHaveBeenCalled()
  })

  it('gives characters with no avatar_data no row', async () => {
    mockGetAllAsync.mockResolvedValue([charRow({ avatar_data: null })])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('creates an inline row with a NULL thumb for a real avatar', async () => {
    mockGetAllAsync.mockResolvedValue([charRow()])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'uuid-mig',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'inline',
      master_ref: 'UklGRkkAAABXRUJQVlA4CUSTOM',
      thumb_ref: null,
      mime_type: 'image/webp',
      source: 'uploaded',
      sync_state: 'local',
    }))
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'uuid-mig')
  })

  it('corrects a mislabelled PNG row rather than trusting mime_type', async () => {
    mockGetAllAsync.mockResolvedValue([
      charRow({ avatar_data: 'iVBORw0KGgoAAAANSUhEUg', avatar_mime_type: 'image/webp' }),
    ])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ mime_type: 'image/png' }))
  })

  it('is idempotent: a second run inserts nothing', async () => {
    mockGetAllAsync.mockResolvedValue([charRow()])
    mockGetImages.mockResolvedValue([{ id: 'existing' }])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('keeps going when one character fails', async () => {
    mockGetAllAsync.mockResolvedValue([charRow({ id: 'char_a' }), charRow({ id: 'char_b' })])
    mockInsert.mockRejectedValueOnce(new Error('insert failed'))
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).toHaveBeenCalledTimes(2)
    // A partial run must not claim completion, so the next launch retries.
    expect(mockStorageSet).not.toHaveBeenCalled()
  })
})

describe('background thumbnail pass', () => {
  it('re-encodes PNG masters instead of relabelling them', async () => {
    mockGetAllAsync.mockResolvedValue([])
    const { backfillThumbnails } = await import('../src/database/migrations/migrateAvatarsToImageStore')
    await backfillThumbnails([
      { id: 'img-1', storage_kind: 'inline', master_ref: 'iVBORw0KGgo', thumb_ref: null, mime_type: 'image/png' } as never,
    ])
    expect(mockPrepareVariants).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'data:image/png;base64,iVBORw0KGgo' }),
    )
    expect(mockUpdateRefs).toHaveBeenCalledWith('img-1', expect.objectContaining({
      master_ref: 'NEWM',
      thumb_ref: 'NEWT',
      mime_type: 'image/webp',
    }))
  })

  it('leaves an inline WebP master alone and only adds the thumb', async () => {
    const { backfillThumbnails } = await import('../src/database/migrations/migrateAvatarsToImageStore')
    await backfillThumbnails([
      { id: 'img-2', storage_kind: 'inline', master_ref: 'UklGRkk', thumb_ref: null, mime_type: 'image/webp' } as never,
    ])
    expect(mockUpdateRefs).toHaveBeenCalledWith('img-2', expect.objectContaining({
      master_ref: 'UklGRkk',
      thumb_ref: 'NEWT',
      mime_type: 'image/webp',
    }))
  })

  it('skips rows that already have a thumb', async () => {
    const { backfillThumbnails } = await import('../src/database/migrations/migrateAvatarsToImageStore')
    await backfillThumbnails([
      { id: 'img-3', storage_kind: 'inline', master_ref: 'UklGRkk', thumb_ref: 'T', mime_type: 'image/webp' } as never,
    ])
    expect(mockPrepareVariants).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/migrateAvatarsToImageStore.test.ts`
Expected: FAIL — `Cannot find module '../src/database/migrations/migrateAvatarsToImageStore'`

- [ ] **Step 3: Implement**

Create `src/database/migrations/migrateAvatarsToImageStore.ts`:

```ts
/**
 * One-shot data move from `characters.avatar_data` into `character_images`.
 *
 * Runs in JS rather than as SQL because it needs three pieces of conditional
 * logic SQL cannot express cleanly: recognising the bundled default so it can
 * be purged, sniffing the true image format of bytes whose recorded mime type
 * is unreliable, and re-encoding the rows that turn out to be mislabelled.
 *
 * `avatar_data` is deliberately left in place and unread for one release as a
 * rollback net; a follow-up drops the column.
 */

import { getDatabase } from '~/database/index'
import { Storage } from '~/utilities/kvStorage'
import {
  getCharacterImages,
  insertCharacterImage,
  setActiveImageId,
  updateImageRefs,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { prepareImageVariants } from '~/services/imageVariants'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'

export const AVATAR_MIGRATION_FLAG = 'avatar-image-store-migration'

interface LegacyAvatarRow {
  id: string
  user_id: string
  avatar_data: string | null
  avatar_mime_type: string | null
  save_to_cloud: number
}

/**
 * Identify the real format from the base64 payload.
 *
 * `saveCharacterImageLocally` and `useAvatarUpload` both hardcoded 'image/webp',
 * but on web `SaveFormat.WEBP` silently produced PNG on browsers without WebP
 * canvas encoding — so some stored rows are PNG bytes labelled WebP.
 */
export function sniffImageMimeType(base64: string): string {
  if (base64.startsWith('UklGR')) return 'image/webp'   // RIFF
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  return 'image/webp'
}

/**
 * Strict byte equality against the shipped default, with a length pre-check so
 * the common case stays cheap.
 *
 * Safe because the constant never changed: only two commits ever touched
 * `src/utilities/defaultAvatarBase64.ts`, both inside PR #395, so no release
 * shipped different default bytes — and `characterMachine` wrote the constant
 * verbatim rather than re-encoding it, making stored copies byte-identical.
 */
function isBundledDefault(avatarData: string, defaultBase64: string): boolean {
  return avatarData.length === defaultBase64.length && avatarData === defaultBase64
}

export async function migrateAvatarsToImageStore(
  userId: string,
  defaultAvatarBase64: string,
): Promise<void> {
  const alreadyRun = await Storage.getItem(AVATAR_MIGRATION_FLAG)
  if (alreadyRun) return

  const db = await getDatabase()
  const rows = await db.getAllAsync<LegacyAvatarRow>(
    'SELECT id, user_id, avatar_data, avatar_mime_type, save_to_cloud FROM characters WHERE user_id = ? AND avatar_data IS NOT NULL',
    [userId],
  )

  let allSucceeded = true

  for (const row of rows) {
    try {
      const avatarData = row.avatar_data
      if (!avatarData) continue

      // Purge the duplicated default: these characters fall through to the
      // bundled asset instead of carrying their own 7.6 KB copy.
      if (isBundledDefault(avatarData, defaultAvatarBase64)) continue

      // Idempotency: a character that already has gallery rows was migrated on
      // an earlier, interrupted run.
      const existing = await getCharacterImages(row.id)
      if (existing.length > 0) continue

      const imageId = generateSecureUuid()
      const imageRow: CharacterImageRow = {
        id: imageId,
        character_id: row.id,
        user_id: row.user_id,
        storage_kind: 'inline',
        master_ref: avatarData,
        // No thumb yet — the background pass derives one. The resolver falls
        // back to the master until then.
        thumb_ref: null,
        mime_type: sniffImageMimeType(avatarData),
        source: 'uploaded',
        sync_state: 'local',
        sync_attempts: 0,
        created_at: Date.now(),
        deleted_at: null,
      }

      await insertCharacterImage(imageRow)
      await setActiveImageId(row.id, imageId)
    } catch (err) {
      console.warn('[avatarMigration] character failed, will retry next launch:', row.id, err)
      allSucceeded = false
    }
  }

  // Only claim completion on a clean pass — a partial run must retry.
  if (allSucceeded) {
    await Storage.setItem(AVATAR_MIGRATION_FLAG, 'done')
  }
}

/**
 * Background pass: derive missing thumbnails and fix mislabelled masters.
 *
 * Correcting `mime_type` is necessary but not sufficient — storage.rules admits
 * only image/webp and image/jpeg, so even a correctly-labelled PNG is rejected
 * at upload. PNG masters are therefore re-encoded, not relabelled; the pass is
 * already invoking the manipulator for the thumb, so it costs one extra output.
 * Rows that stay inline keep their bytes when the format is already acceptable —
 * re-encoding those would cost quality for no gain.
 */
export async function backfillThumbnails(rows: CharacterImageRow[]): Promise<void> {
  for (const row of rows) {
    if (row.thumb_ref) continue

    try {
      const needsReencode = row.mime_type === 'image/png'
      const sourceUri =
        row.storage_kind === 'inline'
          ? `data:${row.mime_type};base64,${row.master_ref}`
          : row.master_ref

      const variants = await prepareImageVariants({ uri: sourceUri, width: 1024, height: 1024 })

      await updateImageRefs(row.id, {
        storage_kind: row.storage_kind,
        master_ref: needsReencode ? variants.master.base64 : row.master_ref,
        thumb_ref: variants.thumb.base64,
        mime_type: needsReencode ? variants.master.mimeType : row.mime_type,
        sync_state: row.sync_state,
      })
    } catch (err) {
      console.warn('[avatarMigration] thumbnail backfill failed for', row.id, err)
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/migrateAvatarsToImageStore.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the migration at startup**

The migration needs the default bytes to compare against, but Task 7 deleted `defaultAvatarBase64.ts`. Restore it as a **migration-local constant** so nothing else can import it: create `src/database/migrations/legacyDefaultAvatarBase64.ts` containing the exact string that was in the deleted `src/utilities/defaultAvatarBase64.ts`:

```bash
git show HEAD~2:src/utilities/defaultAvatarBase64.ts > src/database/migrations/legacyDefaultAvatarBase64.ts
```

Adjust the commit-ish if Task 7's deletion is further back — verify with `git log --oneline -- src/utilities/defaultAvatarBase64.ts`. Then rename the export inside the new file to `LEGACY_DEFAULT_AVATAR_BASE64` and add a header comment:

```ts
/**
 * Frozen copy of the base64 default avatar that shipped from commit bf9d2f66
 * (2026-04-09) until the bundled-asset switch. Retained solely so the one-shot
 * avatar migration can recognise and purge stored copies by strict equality.
 * Do not import this anywhere else — it is dead weight the moment the migration
 * flag is set for every user.
 */
```

In `app/_layout.tsx`, inside the existing startup effect that runs `syncAllToCloud` (the `if (user && !isLoading && !prevUserRef.current)` block), add the migration **before** the sync import:

```tsx
      void import('~/database/migrations/migrateAvatarsToImageStore')
        .then(async ({ migrateAvatarsToImageStore }) => {
          const { LEGACY_DEFAULT_AVATAR_BASE64 } = await import(
            '~/database/migrations/legacyDefaultAvatarBase64'
          )
          await migrateAvatarsToImageStore(user.uid, LEGACY_DEFAULT_AVATAR_BASE64)
          characterService.send({ type: 'LOAD' })
        })
        .catch((err) => console.warn('Avatar migration failed:', err))
```

- [ ] **Step 6: Verify on a real database**

Run the app against a local dev DB that has characters with avatars:

```bash
npm run web
```

Then in the app: open the characters list, confirm avatars still render, open a character's picker and confirm exactly one image is listed for a character that previously had a custom avatar, and zero for one that had the default. Restart the app and confirm the migration does not run again (no duplicate rows in the picker).

- [ ] **Step 7: Commit**

```bash
git add src/database/migrations/ app/_layout.tsx __tests__/migrateAvatarsToImageStore.test.ts
git commit -m "feat(images): migrate legacy avatar_data into the image gallery"
```

**Stage A is complete.** Avatars now have history, the default is bundled once, uploads are square, and nothing touches the cloud.

---

# Stage B — Cloud storage

## Task 12: Storage rules, config, and dependency

**Files:**
- Create: `storage.rules`
- Modify: `firebase.json`
- Modify: `package.json` (add `@react-native-firebase/storage`)
- Test: `__tests__/storageRules.test.ts` (create — static assertions; emulator run is a manual step)

- [ ] **Step 1: Install the native Storage module**

```bash
npm install @react-native-firebase/storage@^23.8.8
```

Expected: resolves to the same major as the other `@react-native-firebase/*` packages already in `dependencies`. The web SDK needs nothing — `firebase@^12.15.0` already ships `firebase/storage`.

- [ ] **Step 2: Write the failing rules test**

Create `__tests__/storageRules.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

const rules = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
const firebaseJson = JSON.parse(readFileSync(join(__dirname, '..', 'firebase.json'), 'utf8'))

describe('storage.rules', () => {
  it('scopes every path to the authenticated uid', () => {
    expect(rules).toContain('match /users/{uid}/{allPaths=**}')
    expect(rules).toContain('request.auth != null && request.auth.uid == uid')
  })

  it('admits only webp and jpeg on write', () => {
    expect(rules).toContain("request.resource.contentType.matches('image/webp')")
    expect(rules).toContain("request.resource.contentType.matches('image/jpeg')")
  })

  it('caps uploads at 2 MB', () => {
    expect(rules).toContain('request.resource.size < 2 * 1024 * 1024')
  })

  it('has no public-read path — sharing goes through signed URLs', () => {
    expect(rules).not.toMatch(/allow read:\s*if true/)
  })

  it('denies everything outside users/', () => {
    expect(rules).toContain('match /{path=**}')
    expect(rules).toContain('allow read, write: if false')
  })
})

describe('firebase.json', () => {
  it('registers the storage rules file', () => {
    expect(firebaseJson.storage).toEqual({ rules: 'storage.rules' })
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- __tests__/storageRules.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../storage.rules'`

- [ ] **Step 4: Write the rules**

Create `storage.rules`:

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    // Character images live under users/{uid}/characters/{cloudCharacterId}/.
    // The uid segment is the whole authorization story: a user can read and
    // write their own tree and nothing else. There is deliberately no
    // public-read path — shared characters hand out short-lived signed URLs
    // instead, so revoking a share never requires rewriting object ACLs.
    match /users/{uid}/{allPaths=**} {
      allow read: if request.auth != null && request.auth.uid == uid;

      allow write: if request.auth != null
                   && request.auth.uid == uid
                   && (request.resource.contentType.matches('image/webp')
                       || request.resource.contentType.matches('image/jpeg'))
                   && request.resource.size < 2 * 1024 * 1024;

      allow delete: if request.auth != null && request.auth.uid == uid;
    }

    match /{path=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Register the rules and set the bucket**

In `firebase.json`, add a `storage` block immediately after the `firestore` block:

```json
  "storage": {
    "rules": "storage.rules"
  },
```

`src/config/firebaseConfig.web.ts:27` already reads `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` — the value just needs setting. Add it to the project's env file(s) and to the EAS environment:

```bash
grep -rn "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET" .env* eas.json 2>/dev/null
```

Set it to the `storageBucket` value from `google-services.json` (`project_info.storage_bucket`). Confirm the two agree:

```bash
node -e "console.log(require('./google-services.json').project_info.storage_bucket)"
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm test -- __tests__/storageRules.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Exercise the rules against the emulator**

```bash
npx firebase emulators:start --only storage
```

With the emulator running, verify by hand in a second terminal or the emulator UI that: an authenticated user can write `users/<their-uid>/characters/c/i.webp`; the same user is denied writing `users/<other-uid>/...`; a 3 MB payload is rejected; and a `text/plain` content type is rejected. Record the outcome in the commit message.

- [ ] **Step 8: Deploy the rules**

```bash
npx firebase deploy --only storage -P clanker-prod
```

Expected: `✔  storage: released rules storage.rules to firebase.storage`

- [ ] **Step 9: Commit**

```bash
git add storage.rules firebase.json package.json package-lock.json __tests__/storageRules.test.ts
git commit -m "feat(storage): add uid-scoped Firebase Storage rules and native storage dep"
```

---

## Task 13: `storageService` — platform-split Firebase Storage access

**Files:**
- Create: `src/services/storageService.ts` (native)
- Create: `src/services/storageService.web.ts` (web)
- Test: `__tests__/storageService.test.ts` (create)
- Test: `__tests__/storageServiceWeb.test.ts` (create)

Native uses `@react-native-firebase/storage`, web uses the `firebase` JS SDK. The split is not cosmetic: native uploads with `putFile(localPath)`, which sidesteps React Native's broken `Blob` implementation entirely, while web uses `uploadBytes` with a real `Blob`.

- [ ] **Step 1: Write the failing native test**

Create `__tests__/storageService.test.ts`:

```ts
const mockPutFile = jest.fn()
const mockGetDownloadURL = jest.fn()
const mockDelete = jest.fn()
const mockRefFn = jest.fn()
const mockWriteBytes = jest.fn()
const mockDeleteBytes = jest.fn()
const mockFileBase64 = jest.fn()

jest.mock('@react-native-firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  ref: (...a: unknown[]) => mockRefFn(...a),
  putFile: (...a: unknown[]) => mockPutFile(...a),
  getDownloadURL: (...a: unknown[]) => mockGetDownloadURL(...a),
  deleteObject: (...a: unknown[]) => mockDelete(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  writeLocalImageBytes: (...a: unknown[]) => mockWriteBytes(...a),
  deleteLocalImageBytes: (...a: unknown[]) => mockDeleteBytes(...a),
}))
jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({ base64: mockFileBase64 })),
}))

import {
  uploadImageBytes,
  getStorageDownloadUrl,
  deleteStorageObject,
  downloadImageBase64,
  __clearDownloadUrlCache,
} from '~/services/storageService'

beforeEach(() => {
  jest.clearAllMocks()
  __clearDownloadUrlCache()
  mockRefFn.mockImplementation((_s: unknown, path: string) => ({ fullPath: path }))
  mockGetDownloadURL.mockResolvedValue('https://cdn/x.webp')
  mockWriteBytes.mockResolvedValue('file:///tmp/upload.webp')
  mockFileBase64.mockResolvedValue('DOWNLOADED64')
})

describe('storageService (native)', () => {
  it('uploads via putFile with an explicit content type', async () => {
    await uploadImageBytes('users/u/characters/c/i.webp', 'B64', 'image/webp')
    expect(mockPutFile).toHaveBeenCalledWith(
      { fullPath: 'users/u/characters/c/i.webp' },
      'file:///tmp/upload.webp',
      { contentType: 'image/webp' },
    )
  })

  it('cleans up the staged local file after upload', async () => {
    await uploadImageBytes('users/u/characters/c/i.webp', 'B64', 'image/webp')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///tmp/upload.webp')
  })

  it('cleans up the staged file even when the upload fails', async () => {
    mockPutFile.mockRejectedValue(new Error('network'))
    await expect(uploadImageBytes('p', 'B64', 'image/webp')).rejects.toThrow('network')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///tmp/upload.webp')
  })

  it('memoizes download URLs per path for the session', async () => {
    await getStorageDownloadUrl('users/u/a.webp')
    await getStorageDownloadUrl('users/u/a.webp')
    expect(mockGetDownloadURL).toHaveBeenCalledTimes(1)
  })

  it('does not memoize across different paths', async () => {
    await getStorageDownloadUrl('users/u/a.webp')
    await getStorageDownloadUrl('users/u/b.webp')
    expect(mockGetDownloadURL).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures', async () => {
    mockGetDownloadURL.mockRejectedValueOnce(new Error('offline'))
    await expect(getStorageDownloadUrl('users/u/a.webp')).rejects.toThrow('offline')
    mockGetDownloadURL.mockResolvedValue('https://cdn/x.webp')
    await expect(getStorageDownloadUrl('users/u/a.webp')).resolves.toBe('https://cdn/x.webp')
  })

  it('treats deleting a missing object as success', async () => {
    mockDelete.mockRejectedValue(Object.assign(new Error('nope'), { code: 'storage/object-not-found' }))
    await expect(deleteStorageObject('users/u/gone.webp')).resolves.toBeUndefined()
  })

  it('propagates non-not-found delete errors', async () => {
    mockDelete.mockRejectedValue(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }))
    await expect(deleteStorageObject('users/u/x.webp')).rejects.toThrow('denied')
  })

  it('downloads an object to base64', async () => {
    await expect(downloadImageBase64('users/u/a.webp')).resolves.toBe('DOWNLOADED64')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/storageService.test.ts`
Expected: FAIL — `Cannot find module '~/services/storageService'`

- [ ] **Step 3: Implement the native service**

Create `src/services/storageService.ts`:

```ts
/**
 * Native Firebase Storage access.
 *
 * Uploads go through `putFile(localPath)` rather than `putString`/`uploadBytes`:
 * React Native's Blob implementation cannot carry binary payloads reliably, and
 * staging to a real file avoids the problem entirely.
 */

import { Directory, File, Paths } from 'expo-file-system'
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  putFile,
  ref,
} from '@react-native-firebase/storage'

/**
 * Download URLs are stable for the lifetime of an object and cost a network
 * round trip each, so the picker rendering 100 thumbs must not re-fetch per
 * render. Failures are never cached — an offline miss must retry.
 */
const downloadUrlCache = new Map<string, string>()

export function __clearDownloadUrlCache(): void {
  downloadUrlCache.clear()
}

function storageRef(path: string) {
  return ref(getStorage(), path)
}

export async function uploadImageBytes(
  path: string,
  base64: string,
  contentType: string,
): Promise<void> {
  // Stage the bytes as a file so putFile can stream them.
  const stagedRef = await stageForUpload(base64)
  try {
    await putFile(storageRef(path), stagedRef, { contentType })
  } finally {
    const { deleteLocalImageBytes } = await import('~/services/localImageStore')
    await deleteLocalImageBytes(stagedRef)
  }
}

async function stageForUpload(base64: string): Promise<string> {
  const { writeLocalImageBytes } = await import('~/services/localImageStore')
  return writeLocalImageBytes(`upload_${Date.now()}_${Math.random().toString(36).slice(2)}`, base64, 'master')
}

export async function getStorageDownloadUrl(path: string): Promise<string> {
  const cached = downloadUrlCache.get(path)
  if (cached) return cached

  const url = await getDownloadURL(storageRef(path))
  downloadUrlCache.set(path, url)
  return url
}

export async function deleteStorageObject(path: string): Promise<void> {
  try {
    await deleteObject(storageRef(path))
  } catch (err) {
    // Idempotent: the cascade re-runs after partial failures, and an object
    // that is already gone means the work is done.
    const code = (err as { code?: string })?.code ?? ''
    if (code === 'storage/object-not-found') return
    throw err
  } finally {
    downloadUrlCache.delete(path)
  }
}

export async function downloadImageBase64(path: string): Promise<string> {
  const url = await getStorageDownloadUrl(path)
  const dir = new Directory(Paths.cache, 'image-downloads')
  if (!dir.exists) dir.create()
  const destination = new File(dir, `dl_${Date.now()}.webp`)

  try {
    await File.downloadFileAsync(url, destination)
    return await destination.base64()
  } finally {
    try {
      destination.delete()
    } catch (err) {
      console.warn('Failed to clean up downloaded image:', err)
    }
  }
}
```

- [ ] **Step 4: Run the native test and watch it pass**

Run: `npm test -- __tests__/storageService.test.ts`
Expected: PASS, 9 tests. The `downloadImageBase64` case needs `File.downloadFileAsync` in the `expo-file-system` mock — add `downloadFileAsync: jest.fn()` as a static on the mocked `File` if the test reports it undefined.

- [ ] **Step 5: Write the failing web test**

Create `__tests__/storageServiceWeb.test.ts`:

```ts
const mockUploadBytes = jest.fn()
const mockGetDownloadURL = jest.fn()
const mockDeleteObject = jest.fn()

jest.mock('firebase/storage', () => ({
  getStorage: jest.fn(() => ({})),
  ref: jest.fn((_s: unknown, path: string) => ({ fullPath: path })),
  uploadBytes: (...a: unknown[]) => mockUploadBytes(...a),
  getDownloadURL: (...a: unknown[]) => mockGetDownloadURL(...a),
  deleteObject: (...a: unknown[]) => mockDeleteObject(...a),
}))
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))

import {
  uploadImageBytes,
  getStorageDownloadUrl,
  deleteStorageObject,
  downloadImageBase64,
  __clearDownloadUrlCache,
} from '~/services/storageService.web'

const realFetch = global.fetch

beforeEach(() => {
  jest.clearAllMocks()
  __clearDownloadUrlCache()
  mockGetDownloadURL.mockResolvedValue('https://cdn/x.webp')
})

afterEach(() => { global.fetch = realFetch })

describe('storageService (web)', () => {
  it('uploads a Blob with the declared content type', async () => {
    await uploadImageBytes('users/u/a.webp', btoa('bytes'), 'image/webp')
    const [, blob, meta] = mockUploadBytes.mock.calls[0] as [unknown, Blob, { contentType: string }]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/webp')
    expect(meta).toEqual({ contentType: 'image/webp' })
  })

  it('memoizes download URLs per path', async () => {
    await getStorageDownloadUrl('users/u/a.webp')
    await getStorageDownloadUrl('users/u/a.webp')
    expect(mockGetDownloadURL).toHaveBeenCalledTimes(1)
  })

  it('treats a missing object as deleted', async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error('x'), { code: 'storage/object-not-found' }))
    await expect(deleteStorageObject('users/u/a.webp')).resolves.toBeUndefined()
  })

  it('downloads through fetch and returns base64 without the data-URI prefix', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/webp' }),
    })) as never
    const result = await downloadImageBase64('users/u/a.webp')
    expect(result).not.toContain('data:')
    expect(typeof result).toBe('string')
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- __tests__/storageServiceWeb.test.ts`
Expected: FAIL — `Cannot find module '~/services/storageService.web'`

- [ ] **Step 7: Implement the web service**

Create `src/services/storageService.web.ts`:

```ts
/**
 * Web Firebase Storage access via the `firebase` JS SDK.
 *
 * Unlike native, `Blob` here is a real Blob, so `uploadBytes` is the direct path
 * and no file staging is involved.
 */

import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { firebaseApp } from '~/config/firebaseConfig.web'

const downloadUrlCache = new Map<string, string>()

export function __clearDownloadUrlCache(): void {
  downloadUrlCache.clear()
}

function storageRef(path: string) {
  return ref(getStorage(firebaseApp), path)
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: contentType })
}

export async function uploadImageBytes(
  path: string,
  base64: string,
  contentType: string,
): Promise<void> {
  await uploadBytes(storageRef(path), base64ToBlob(base64, contentType), { contentType })
}

export async function getStorageDownloadUrl(path: string): Promise<string> {
  const cached = downloadUrlCache.get(path)
  if (cached) return cached

  const url = await getDownloadURL(storageRef(path))
  downloadUrlCache.set(path, url)
  return url
}

export async function deleteStorageObject(path: string): Promise<void> {
  try {
    await deleteObject(storageRef(path))
  } catch (err) {
    const code = (err as { code?: string })?.code ?? ''
    if (code === 'storage/object-not-found') return
    throw err
  } finally {
    downloadUrlCache.delete(path)
  }
}

export async function downloadImageBase64(path: string): Promise<string> {
  const url = await getStorageDownloadUrl(path)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${path}: ${response.status}`)
  }
  const blob = await response.blob()

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read downloaded image'))
    reader.onload = () => {
      const result = String(reader.result)
      // Strip the `data:<mime>;base64,` prefix — callers store bare base64.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}
```

Export `firebaseApp` from `src/config/firebaseConfig.web.ts` if it is not already exported (it is currently a module-local `const firebaseApp: FirebaseApp = …` near the top).

- [ ] **Step 8: Run the web test and watch it pass**

Run: `npm test -- __tests__/storageServiceWeb.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add src/services/storageService.ts src/services/storageService.web.ts src/config/firebaseConfig.web.ts __tests__/storageService.test.ts __tests__/storageServiceWeb.test.ts
git commit -m "feat(storage): add platform-split Firebase Storage service"
```

---

## Task 14: Route cloud characters to Storage

**Files:**
- Modify: `src/services/characterImageService.ts`
- Modify: `src/services/localImageStore.ts` / `.web.ts`
- Test: `__tests__/characterImageService.test.ts` (extend)
- Test: `__tests__/localImageStore.test.ts` (extend)

Routing happens **client-side, keyed on `save_to_cloud`**. The Cloud Function never learns a character's privacy state, so it cannot leak it.

- [ ] **Step 1: Extend the resolver tests**

Add to `__tests__/localImageStore.test.ts` — first the mock, alongside the existing ones:

```ts
jest.mock('~/services/storageService', () => ({
  getStorageDownloadUrl: jest.fn(async (path: string) => `https://cdn/${path}`),
}))
```

then the cases:

```ts
  it('resolves cloud rows to a download URL', async () => {
    const r = row({ storage_kind: 'cloud', master_ref: 'users/u/characters/c/img-1.webp' })
    await expect(resolveImageUri(r, 'master')).resolves.toBe(
      'https://cdn/users/u/characters/c/img-1.webp',
    )
  })

  it('resolves the cloud thumb path when present', async () => {
    const r = row({
      storage_kind: 'cloud',
      master_ref: 'users/u/characters/c/img-1.webp',
      thumb_ref: 'users/u/characters/c/img-1_thumb.webp',
    })
    await expect(resolveImageUri(r, 'thumb')).resolves.toBe(
      'https://cdn/users/u/characters/c/img-1_thumb.webp',
    )
  })
```

Add the same two cases to `__tests__/localImageStoreWeb.test.ts` with `~/services/storageService.web` mocked instead.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- __tests__/localImageStore.test.ts __tests__/localImageStoreWeb.test.ts`
Expected: FAIL — `Cloud image resolution is not available yet`

- [ ] **Step 3: Implement cloud resolution**

In `src/services/localImageStore.ts`, add the import:
```ts
import { getStorageDownloadUrl } from '~/services/storageService'
```
and replace the `case 'cloud':` body with:
```ts
    case 'cloud':
      return getStorageDownloadUrl(ref)
```

Make the same change in `src/services/localImageStore.web.ts`, importing from `~/services/storageService.web`.

- [ ] **Step 4: Run them and watch them pass**

Run: `npm test -- __tests__/localImageStore.test.ts __tests__/localImageStoreWeb.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend the service tests for cloud routing**

Add to `__tests__/characterImageService.test.ts` — first the mock:

```ts
const mockUploadImageBytes = jest.fn()
jest.mock('~/services/storageService', () => ({
  uploadImageBytes: (...a: unknown[]) => mockUploadImageBytes(...a),
  deleteStorageObject: jest.fn(),
}))
```

then the cases:

```ts
describe('cloud routing', () => {
  it('uploads and stores object paths for a synced cloud character', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: true, cloud_id: 'cloud-uuid' })
    const row = await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 1024, height: 1024, source: 'generated',
    })
    expect(mockUploadImageBytes).toHaveBeenCalledWith(
      'users/user-1/characters/cloud-uuid/uuid-new.webp', 'M64', 'image/webp',
    )
    expect(mockUploadImageBytes).toHaveBeenCalledWith(
      'users/user-1/characters/cloud-uuid/uuid-new_thumb.webp', 'T64', 'image/webp',
    )
    expect(row).toMatchObject({
      storage_kind: 'cloud',
      master_ref: 'users/user-1/characters/cloud-uuid/uuid-new.webp',
      thumb_ref: 'users/user-1/characters/cloud-uuid/uuid-new_thumb.webp',
      sync_state: 'synced',
    })
  })

  it('keeps the image locally as pending_upload when the upload fails', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: true, cloud_id: 'cloud-uuid' })
    mockUploadImageBytes.mockRejectedValue(new Error('network down'))
    const row = await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 1024, height: 1024, source: 'generated',
    })
    expect(row).toMatchObject({ storage_kind: 'file', sync_state: 'pending_upload' })
    expect(mockInsert).toHaveBeenCalledWith(row)
  })

  it('stays pending_upload when the character has no confirmed cloud_id yet', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: true, cloud_id: null })
    const row = await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 1024, height: 1024, source: 'generated',
    })
    expect(mockUploadImageBytes).not.toHaveBeenCalled()
    expect(row.sync_state).toBe('pending_upload')
  })

  it('ignores a non-uuid cloud_id rather than building an unreachable path', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: true, cloud_id: 'char_local_x' })
    const row = await saveCharacterImage({
      characterId: 'char_a', userId: 'user-1', uri: 'file://s.jpg',
      width: 1024, height: 1024, source: 'generated',
    })
    expect(mockUploadImageBytes).not.toHaveBeenCalled()
    expect(row.sync_state).toBe('pending_upload')
  })
})
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npm test -- __tests__/characterImageService.test.ts`
Expected: FAIL — the cloud cases still produce `storage_kind: 'file'` and `sync_state: 'local'`.

- [ ] **Step 7: Implement cloud routing**

In `src/services/characterImageService.ts`, add:

```ts
import { uploadImageBytes } from '~/services/storageService'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Storage paths are keyed on the **confirmed** cloud id, never the local
 * `char_…` id and never `pending_cloud_id`.
 *
 * The local id is device-private: a second device restoring the same character
 * holds a different one, so a path built from it is unresolvable there. And the
 * server's returned id is authoritative — building a path from a locally-guessed
 * id the server then disagrees with would strand objects at a location nothing
 * can reach. Waiting one sweep cycle is the cheaper side of that trade.
 */
export function buildStoragePath(
  userId: string,
  cloudCharacterId: string,
  imageId: string,
  variant: 'master' | 'thumb',
): string {
  const suffix = variant === 'thumb' ? '_thumb' : ''
  return `users/${userId}/characters/${cloudCharacterId}/${imageId}${suffix}.webp`
}
```

Replace the byte-writing block inside `saveCharacterImage` (everything from `const kind = localStorageKind()` through the `const row: CharacterImageRow = {…}` literal) with:

```ts
  const cloudId =
    character.save_to_cloud && character.cloud_id && UUID_REGEX.test(character.cloud_id)
      ? character.cloud_id
      : null

  let storageKind: 'cloud' | 'file' | 'inline' = localStorageKind()
  let masterRef: string
  let thumbRef: string | null
  let syncState: CharacterImageRow['sync_state'] = 'local'

  if (cloudId) {
    const masterPath = buildStoragePath(input.userId, cloudId, imageId, 'master')
    const thumbPath = buildStoragePath(input.userId, cloudId, imageId, 'thumb')
    try {
      await uploadImageBytes(masterPath, variants.master.base64, variants.master.mimeType)
      await uploadImageBytes(thumbPath, variants.thumb.base64, variants.thumb.mimeType)
      storageKind = 'cloud'
      masterRef = masterPath
      thumbRef = thumbPath
      syncState = 'synced'
    } catch (err) {
      // Never lose an image the user spent credits on: fall back to a local copy
      // marked for the sweeper. The avatar still displays and the credits are not
      // wasted even if the upload never succeeds — only cloud redundancy is lost.
      console.warn('[characterImages] upload failed, keeping local copy:', err)
      storageKind = localStorageKind()
      masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
      thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')
      syncState = 'pending_upload'
    }
  } else {
    masterRef = await writeLocalImageBytes(imageId, variants.master.base64, 'master')
    thumbRef = await writeLocalImageBytes(imageId, variants.thumb.base64, 'thumb')
    // A cloud character with no confirmed cloud_id yet has no path to write to.
    // Marking it pending_upload lets the sweeper pick it up after the next
    // character sync confirms the id.
    syncState = character.save_to_cloud ? 'pending_upload' : 'local'
  }

  const row: CharacterImageRow = {
    id: imageId,
    character_id: input.characterId,
    user_id: input.userId,
    storage_kind: storageKind,
    master_ref: masterRef,
    thumb_ref: thumbRef,
    mime_type: variants.master.mimeType,
    source: input.source,
    sync_state: syncState,
    sync_attempts: 0,
    created_at: Date.now(),
    deleted_at: null,
  }
```

Also extend `removeImageBytesThenRow` to handle cloud rows:

```ts
  if (row.storage_kind === 'cloud') {
    await deleteStorageObject(row.master_ref)
    if (row.thumb_ref) await deleteStorageObject(row.thumb_ref)
  }
```

importing `deleteStorageObject` from `~/services/storageService`.

- [ ] **Step 8: Run the suite and watch it pass**

Run: `npm test -- __tests__/characterImageService.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 9: Verify on device**

Run the app signed in as a real user, with a character whose `save_to_cloud` is on and which has already synced (so it has a `cloud_id`). Generate an avatar, then confirm in the Firebase console that `users/<uid>/characters/<cloudId>/<imageId>.webp` and `…_thumb.webp` both exist and that the avatar renders from the CDN URL.

- [ ] **Step 10: Commit**

```bash
git add src/services/characterImageService.ts src/services/localImageStore.ts src/services/localImageStore.web.ts __tests__/characterImageService.test.ts __tests__/localImageStore.test.ts __tests__/localImageStoreWeb.test.ts
git commit -m "feat(images): upload cloud-mode avatars to Firebase Storage"
```

**Stage B is complete.** Cloud-mode characters back their avatars up to Storage; privacy-mode characters never leave the device.

---

# Stage C — Cloud sync

## Task 15: Cloud Postgres schema

**Files:**
- Create: `functions/drizzle/0022_character_images.sql`
- Modify: `functions/src/db/schema.ts`
- Test: `functions/src/db/characterImagesMigration.test.ts` (create)

> **Migration constraint:** hand-write the SQL file. Do **not** run `drizzle-kit generate` — the journal is out of sync with the migration directory, and regenerating will produce a file that conflicts with what has already been applied to production.

The cloud table carries `storage_path` / `thumb_path` instead of `storage_kind` / `master_ref`: cloud rows are always kind `cloud`, so the discriminator is meaningless there.

`deleted_at` is load-bearing, not vestigial: a soft-deleted cloud row is the **tombstone** other devices reconcile against.

- [ ] **Step 1: Write the failing test**

Create `functions/src/db/characterImagesMigration.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const sql = readFileSync(
  join(process.cwd(), "drizzle", "0022_character_images.sql"),
  "utf8"
);

test("creates character_images with the cloud column shape", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "character_images"/);
  assert.match(sql, /"storage_path" text NOT NULL/);
  assert.match(sql, /"thumb_path" text/);
  assert.match(sql, /"mime_type" text NOT NULL DEFAULT 'image\/webp'/);
  assert.match(sql, /"deleted_at" timestamp with time zone/);
});

test("cascades from characters and users", () => {
  assert.match(sql, /REFERENCES "characters"\("id"\) ON DELETE CASCADE/);
  assert.match(sql, /REFERENCES "users"\("id"\) ON DELETE CASCADE/);
});

test("indexes the reconciliation lookup", () => {
  assert.match(sql, /character_images_character_id_idx/);
  assert.match(sql, /character_images_user_id_idx/);
});

test("adds characters.active_image_id", () => {
  assert.match(sql, /ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "active_image_id" uuid/);
});

test("is re-runnable", () => {
  assert.match(sql, /IF NOT EXISTS/);
  assert.doesNotMatch(sql, /DROP TABLE/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd functions && npm test`
Expected: FAIL — `ENOENT: no such file or directory, open '.../drizzle/0022_character_images.sql'`

- [ ] **Step 3: Write the migration**

Create `functions/drizzle/0022_character_images.sql`:

```sql
-- Character image gallery (avatars). Mirrors the local SQLite table, minus the
-- storage_kind discriminator: cloud rows are always Firebase Storage objects.
--
-- deleted_at is the tombstone other devices reconcile against, NOT a soft-delete
-- convenience. Rows are retained for 30 days after deletion, then dropped by a
-- retention pass; the Storage objects are deleted immediately, so only the row
-- lingers and rows are tens of bytes.

CREATE TABLE IF NOT EXISTS "character_images" (
  "id" uuid PRIMARY KEY NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "storage_path" text NOT NULL,
  "thumb_path" text,
  "mime_type" text NOT NULL DEFAULT 'image/webp',
  "source" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "character_images_character_id_idx"
  ON "character_images" ("character_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "character_images_user_id_idx"
  ON "character_images" ("user_id");

-- Live-row lookup for the server-side cap: the cap counts only non-tombstoned rows.
CREATE INDEX IF NOT EXISTS "character_images_live_idx"
  ON "character_images" ("character_id", "created_at")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "active_image_id" uuid;
```

Note the deliberate absence of a foreign key on `characters.active_image_id`: a `SET NULL` cascade would silently clear the active avatar when an image row is hard-deleted by the retention pass, and the application already promotes a replacement.

- [ ] **Step 4: Add the Drizzle table**

In `functions/src/db/schema.ts`, add `active_image_id` to the `characters` table definition:

```ts
  activeImageId: uuid('active_image_id'),
```

(place it after `saveToCloud`), and add the new table immediately after `characters`:

```ts
export const characterImages = pgTable('character_images', {
  id: uuid('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  storagePath: text('storage_path').notNull(),
  thumbPath: text('thumb_path'),
  mimeType: text('mime_type').notNull().default('image/webp'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Tombstone: retained 30 days so other devices can reconcile a deletion they
  // were offline for. Absence is ambiguous; an explicit deleted_at is not.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  characterIdIdx: index('character_images_character_id_idx').on(table.characterId, table.createdAt.desc()),
  userIdIdx: index('character_images_user_id_idx').on(table.userId),
}));
```

Note the PK has no `.defaultRandom()`: the id is minted **on the device that creates the image** and reused verbatim as the cloud primary key, so the server must never generate one.

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd functions && npm test`
Expected: PASS — 5 new tests, no regressions.

- [ ] **Step 6: Apply the migration to the dev database**

```bash
cd functions && npm run migrate:dev
```

Expected: the runner reports applying `0022_character_images.sql`. Verify:

```bash
cd functions && node -e "process.env.NODE_ENV='development'" # then inspect via your usual psql/dev tooling
```

Confirm `\d character_images` shows the columns above and `\d characters` shows `active_image_id`.

- [ ] **Step 7: Commit**

```bash
git add functions/drizzle/0022_character_images.sql functions/src/db/schema.ts functions/src/db/characterImagesMigration.test.ts
git commit -m "feat(db): add cloud character_images table and active_image_id"
```

---

## Task 16: Cloud-side image service and Storage admin helpers

**Files:**
- Create: `functions/src/services/characterImageService.ts`
- Create: `functions/src/services/storageAdmin.ts`
- Test: `functions/src/services/characterImageService.test.ts` (create)
- Test: `functions/src/services/storageAdmin.test.ts` (create)

The server owns the cap for cloud characters. Two devices can each hold fewer than 100 images while the cloud total exceeds it, so a client-only cap cannot be correct.

- [ ] **Step 1: Write the failing storage-admin test**

Create `functions/src/services/storageAdmin.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";

const {createStorageAdmin} = await import("./storageAdmin.js");

function fakeBucket() {
  const deleted: string[] = [];
  const listed: string[][] = [];
  return {
    deleted,
    listed,
    bucket: {
      getFiles: async ({prefix}: {prefix: string}) => {
        listed.push([prefix]);
        return [[
          {name: `${prefix}a.webp`, delete: async () => { deleted.push(`${prefix}a.webp`); }},
          {name: `${prefix}b.webp`, delete: async () => { deleted.push(`${prefix}b.webp`); }},
        ]];
      },
      file: (name: string) => ({
        delete: async () => { deleted.push(name); },
        getSignedUrl: async (opts: Record<string, unknown>) => [`https://signed/${name}?exp=${String(opts.expires)}`],
      }),
    },
  };
}

test("deletePrefix lists then deletes every object under the prefix", async () => {
  const {bucket, deleted, listed} = fakeBucket();
  const admin = createStorageAdmin(() => bucket as never);
  await admin.deletePrefix("users/u1/characters/c1/");
  assert.deepEqual(listed, [["users/u1/characters/c1/"]]);
  assert.deepEqual(deleted, ["users/u1/characters/c1/a.webp", "users/u1/characters/c1/b.webp"]);
});

test("deletePrefix is idempotent: a missing object is not an error", async () => {
  const admin = createStorageAdmin(() => ({
    getFiles: async () => [[{
      name: "x", delete: async () => { throw Object.assign(new Error("gone"), {code: 404}); },
    }]],
  }) as never);
  await admin.deletePrefix("users/u1/");
});

test("deleteObjects removes each named object", async () => {
  const {bucket, deleted} = fakeBucket();
  const admin = createStorageAdmin(() => bucket as never);
  await admin.deleteObjects(["users/u1/a.webp", "users/u1/a_thumb.webp"]);
  assert.deepEqual(deleted, ["users/u1/a.webp", "users/u1/a_thumb.webp"]);
});

test("createSignedUrl issues a 15-minute V4 read URL", async () => {
  const {bucket} = fakeBucket();
  const admin = createStorageAdmin(() => bucket as never);
  const before = Date.now();
  const url = await admin.createSignedUrl("users/u1/a.webp");
  assert.match(url, /^https:\/\/signed\/users\/u1\/a\.webp\?exp=/);
  const expires = Number(url.split("exp=")[1]);
  assert.ok(expires >= before + 14 * 60 * 1000);
  assert.ok(expires <= before + 16 * 60 * 1000);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd functions && npm test`
Expected: FAIL — `Cannot find module './storageAdmin.js'`

- [ ] **Step 3: Implement `storageAdmin`**

Create `functions/src/services/storageAdmin.ts`:

```ts
import {getStorage} from "firebase-admin/storage";
import type {Bucket} from "@google-cloud/storage";
import * as logger from "firebase-functions/logger";

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

type BucketProvider = () => Bucket;

const defaultBucketProvider: BucketProvider = () => getStorage().bucket();

/**
 * Server-side Storage operations the client cannot perform: prefix deletes
 * (the client may be offline, or the objects may belong to another device) and
 * signed URLs for public character import.
 */
export const createStorageAdmin = (bucketProvider: BucketProvider = defaultBucketProvider) => ({
  /**
   * List-then-delete loop. Not atomic, but idempotent — a partial failure is
   * safe to re-run, which is exactly what the deletion paths need.
   */
  async deletePrefix(prefix: string): Promise<void> {
    const [files] = await bucketProvider().getFiles({prefix});
    for (const file of files) {
      try {
        await file.delete();
      } catch (error) {
        const code = (error as {code?: number}).code;
        if (code === 404) continue;
        logger.warn("Failed to delete storage object during prefix delete", {
          prefix,
          name: file.name,
          error,
        });
      }
    }
  },

  async deleteObjects(paths: string[]): Promise<void> {
    const bucket = bucketProvider();
    for (const path of paths) {
      try {
        await bucket.file(path).delete();
      } catch (error) {
        const code = (error as {code?: number}).code;
        if (code === 404) continue;
        logger.warn("Failed to delete storage object", {path, error});
      }
    }
  },

  /**
   * V4 signed read URL, 15 minutes.
   *
   * DEPLOY-TIME TRAP: this requires the runtime service account to hold
   * roles/iam.serviceAccountTokenCreator **on itself**, or the call fails with a
   * signBlob permission error. That is IAM configuration, not a code defect.
   */
  async createSignedUrl(path: string): Promise<string> {
    const [url] = await bucketProvider().file(path).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  },
});

export const storageAdmin = createStorageAdmin();
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd functions && npm test`
Expected: PASS — 4 new tests.

- [ ] **Step 5: Write the failing image-service test**

Create `functions/src/services/characterImageService.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";

const {createCharacterImageService} = await import("./characterImageService.js");

type Row = {
  id: string;
  characterId: string;
  userId: string;
  storagePath: string;
  thumbPath: string | null;
  mimeType: string;
  source: string;
  createdAt: Date;
  deletedAt: Date | null;
};

function makeStore(initial: Row[] = []) {
  const rows = [...initial];
  return {
    rows,
    repo: {
      async listByCharacter(characterId: string): Promise<Row[]> {
        return rows
          .filter((r) => r.characterId === characterId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },
      async listLiveByCharacter(characterId: string): Promise<Row[]> {
        return rows
          .filter((r) => r.characterId === characterId && !r.deletedAt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      async upsert(row: Row): Promise<void> {
        const idx = rows.findIndex((r) => r.id === row.id);
        if (idx >= 0) rows[idx] = row; else rows.push(row);
      },
      async tombstone(id: string): Promise<void> {
        const row = rows.find((r) => r.id === id);
        if (row) row.deletedAt = new Date();
      },
      async getActiveImageId(): Promise<string | null> {
        return activeImageId;
      },
      async setActiveImageId(_characterId: string, id: string | null): Promise<void> {
        activeImageId = id;
      },
      async deleteByCharacter(characterId: string): Promise<void> {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].characterId === characterId) rows.splice(i, 1);
        }
      },
    },
  };
}

let activeImageId: string | null = null;
const deletedObjects: string[] = [];
const storage = {
  deleteObjects: async (paths: string[]) => { deletedObjects.push(...paths); },
  deletePrefix: async () => {},
  createSignedUrl: async (p: string) => `https://signed/${p}`,
};

function row(id: string, createdAt: number, overrides: Partial<Row> = {}): Row {
  return {
    id,
    characterId: "c1",
    userId: "u1",
    storagePath: `users/u1/characters/c1/${id}.webp`,
    thumbPath: `users/u1/characters/c1/${id}_thumb.webp`,
    mimeType: "image/webp",
    source: "generated",
    createdAt: new Date(createdAt),
    deletedAt: null,
    ...overrides,
  };
}

test("inserting below the cap evicts nothing", async () => {
  activeImageId = null;
  deletedObjects.length = 0;
  const {repo} = makeStore([row("a", 1)]);
  const service = createCharacterImageService(repo as never, storage as never);
  const result = await service.syncImages("c1", "u1", [row("b", 2)]);
  assert.deepEqual(result.evictedImageIds, []);
});

test("inserting over the cap evicts the oldest and returns their ids", async () => {
  activeImageId = null;
  deletedObjects.length = 0;
  const existing = Array.from({length: 100}, (_, i) => row(`old-${i}`, i + 1));
  const {repo} = makeStore(existing);
  const service = createCharacterImageService(repo as never, storage as never);
  const result = await service.syncImages("c1", "u1", [row("new", 1000)]);
  assert.deepEqual(result.evictedImageIds, ["old-0"]);
  assert.deepEqual(deletedObjects, [
    "users/u1/characters/c1/old-0.webp",
    "users/u1/characters/c1/old-0_thumb.webp",
  ]);
});

test("the active image is never evicted", async () => {
  activeImageId = "old-0";
  deletedObjects.length = 0;
  const existing = Array.from({length: 100}, (_, i) => row(`old-${i}`, i + 1));
  const {repo} = makeStore(existing);
  const service = createCharacterImageService(repo as never, storage as never);
  const result = await service.syncImages("c1", "u1", [row("new", 1000)]);
  assert.deepEqual(result.evictedImageIds, ["old-1"]);
});

test("eviction tombstones the row rather than deleting it", async () => {
  activeImageId = null;
  const existing = Array.from({length: 100}, (_, i) => row(`old-${i}`, i + 1));
  const store = makeStore(existing);
  const service = createCharacterImageService(store.repo as never, storage as never);
  await service.syncImages("c1", "u1", [row("new", 1000)]);
  const evicted = store.rows.find((r) => r.id === "old-0");
  assert.ok(evicted);
  assert.ok(evicted.deletedAt instanceof Date);
});

test("deleting an image tombstones it and removes its objects", async () => {
  activeImageId = null;
  deletedObjects.length = 0;
  const store = makeStore([row("a", 1)]);
  const service = createCharacterImageService(store.repo as never, storage as never);
  await service.deleteImages("c1", "u1", ["a"]);
  assert.deepEqual(deletedObjects, [
    "users/u1/characters/c1/a.webp",
    "users/u1/characters/c1/a_thumb.webp",
  ]);
  assert.ok(store.rows[0].deletedAt);
});

test("listing returns tombstones so clients can reconcile deletions", async () => {
  const store = makeStore([row("a", 1), row("b", 2, {deletedAt: new Date(3)})]);
  const service = createCharacterImageService(store.repo as never, storage as never);
  const images = await service.listImages("c1");
  assert.deepEqual(images.map((i) => i.id).sort(), ["a", "b"]);
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd functions && npm test`
Expected: FAIL — `Cannot find module './characterImageService.js'`

- [ ] **Step 7: Implement**

Create `functions/src/services/characterImageService.ts`:

```ts
import {and, desc, eq, isNull} from "drizzle-orm";
import {getDb} from "../db/client.js";
import {characterImages, characters} from "../db/schema.js";
import {storageAdmin} from "./storageAdmin.js";

export const IMAGE_CAP_PER_CHARACTER = 100;

export type CharacterImageRecord = typeof characterImages.$inferSelect;

export type CharacterImageRepository = {
  listByCharacter(characterId: string): Promise<CharacterImageRecord[]>;
  listLiveByCharacter(characterId: string): Promise<CharacterImageRecord[]>;
  upsert(row: typeof characterImages.$inferInsert): Promise<void>;
  tombstone(id: string): Promise<void>;
  getActiveImageId(characterId: string): Promise<string | null>;
  setActiveImageId(characterId: string, imageId: string | null): Promise<void>;
  deleteByCharacter(characterId: string): Promise<void>;
};

export const createCharacterImageRepository = (): CharacterImageRepository => ({
  async listByCharacter(characterId) {
    const db = await getDb();
    return db.select().from(characterImages)
      .where(eq(characterImages.characterId, characterId))
      .orderBy(desc(characterImages.createdAt));
  },
  async listLiveByCharacter(characterId) {
    const db = await getDb();
    return db.select().from(characterImages)
      .where(and(eq(characterImages.characterId, characterId), isNull(characterImages.deletedAt)))
      .orderBy(characterImages.createdAt);
  },
  async upsert(row) {
    const db = await getDb();
    await db.insert(characterImages).values(row).onConflictDoUpdate({
      target: characterImages.id,
      set: {
        storagePath: row.storagePath,
        thumbPath: row.thumbPath ?? null,
        mimeType: row.mimeType ?? "image/webp",
        source: row.source,
      },
    });
  },
  async tombstone(id) {
    const db = await getDb();
    await db.update(characterImages).set({deletedAt: new Date()})
      .where(eq(characterImages.id, id));
  },
  async getActiveImageId(characterId) {
    const db = await getDb();
    const [row] = await db.select({activeImageId: characters.activeImageId})
      .from(characters).where(eq(characters.id, characterId)).limit(1);
    return row?.activeImageId ?? null;
  },
  async setActiveImageId(characterId, imageId) {
    const db = await getDb();
    await db.update(characters).set({activeImageId: imageId})
      .where(eq(characters.id, characterId));
  },
  async deleteByCharacter(characterId) {
    const db = await getDb();
    await db.delete(characterImages).where(eq(characterImages.characterId, characterId));
  },
});

type StorageOps = Pick<typeof storageAdmin, "deleteObjects" | "deletePrefix">;

export const createCharacterImageService = (
  repository: CharacterImageRepository = createCharacterImageRepository(),
  storage: StorageOps = storageAdmin
) => {
  /** Objects backing one row: master plus thumb when present. */
  const objectPathsFor = (row: CharacterImageRecord): string[] =>
    row.thumbPath ? [row.storagePath, row.thumbPath] : [row.storagePath];

  const tombstoneWithObjects = async (row: CharacterImageRecord): Promise<void> => {
    // Bytes before rows: a failure partway leaves a recoverable row pointing at
    // possibly-missing bytes. The reverse would strand objects nothing references.
    await storage.deleteObjects(objectPathsFor(row));
    await repository.tombstone(row.id);
  };

  return {
    /**
     * Upsert the client's new rows, then enforce the cap.
     *
     * The cap lives here, not on the client: two devices can each hold fewer
     * than 100 images while the cloud total exceeds it, so no single client can
     * see the whole set. Evicted ids come back so the caller can apply the same
     * deletion locally without waiting for the next reconciliation.
     */
    async syncImages(
      characterId: string,
      userId: string,
      rows: (typeof characterImages.$inferInsert)[]
    ): Promise<{evictedImageIds: string[]}> {
      for (const row of rows) {
        await repository.upsert({...row, characterId, userId});
      }

      const live = await repository.listLiveByCharacter(characterId);
      const excess = live.length - IMAGE_CAP_PER_CHARACTER;
      if (excess <= 0) return {evictedImageIds: []};

      const activeImageId = await repository.getActiveImageId(characterId);
      const evictable = live.filter((row) => row.id !== activeImageId);
      const evicted = evictable.slice(0, excess);

      for (const row of evicted) {
        await tombstoneWithObjects(row);
      }

      return {evictedImageIds: evicted.map((row) => row.id)};
    },

    async deleteImages(characterId: string, userId: string, imageIds: string[]): Promise<void> {
      void userId;
      const rows = await repository.listByCharacter(characterId);
      const targets = rows.filter((row) => imageIds.includes(row.id) && !row.deletedAt);
      for (const row of targets) {
        await tombstoneWithObjects(row);
      }
    },

    /** Includes tombstones — absence is ambiguous, an explicit deleted_at is not. */
    async listImages(characterId: string): Promise<CharacterImageRecord[]> {
      return repository.listByCharacter(characterId);
    },

    async setActiveImage(characterId: string, imageId: string | null): Promise<void> {
      await repository.setActiveImageId(characterId, imageId);
    },

    /**
     * Character hard-delete: the parent is gone, so tombstones have nothing left
     * to reconcile against and the rows go too.
     */
    async purgeCharacter(userId: string, characterId: string): Promise<void> {
      await storage.deletePrefix(`users/${userId}/characters/${characterId}/`);
      await repository.deleteByCharacter(characterId);
    },
  };
};

export const characterImageService = createCharacterImageService();
```

Check the import path for `getDb` against the other services (`grep -n "getDb" functions/src/services/characterService.ts`) and match it exactly.

- [ ] **Step 8: Run it and watch it pass**

Run: `cd functions && npm test`
Expected: PASS — 6 new tests.

- [ ] **Step 9: Commit**

```bash
git add functions/src/services/characterImageService.ts functions/src/services/storageAdmin.ts functions/src/services/characterImageService.test.ts functions/src/services/storageAdmin.test.ts
git commit -m "feat(functions): add cloud image service with server-authoritative cap"
```

---

## Task 17: `syncCharacterImages` callable and `images` on the character snapshot

**Files:**
- Modify: `functions/src/characterFunctions.ts`
- Modify: `functions/src/index.ts` (export the new callable)
- Modify: `src/config/firebaseConfig.ts` / `.web.ts` (register the callable)
- Modify: `src/services/apiClient.ts`
- Test: `functions/src/characterFunctions.test.ts` (extend)

Image history is an append-mostly log with deletions. It cannot ride inside the character snapshot `syncCharacter` pushes, and it cannot use the last-write-wins-on-`updated_at` rule `restoreFromCloud` applies to characters — there is no single row whose timestamp settles a set difference. It gets its own callable.

- [ ] **Step 1: Write the failing handler tests**

Append to `functions/src/characterFunctions.test.ts`:

```ts
const {syncCharacterImagesHandler} = await import("./characterFunctions.js");

function imageDeps(overrides: Record<string, unknown> = {}) {
  return {
    userRepository: {
      findUserByFirebaseUid: async () => ({id: "user-uuid", firebaseUid: "uid-1"}),
    },
    characterService: {
      getUserCharacters: async () => [{id: "11111111-1111-4111-8111-111111111111"}],
    },
    characterImageService: {
      syncImages: async () => ({evictedImageIds: []}),
      deleteImages: async () => {},
      listImages: async () => [],
      setActiveImage: async () => {},
      ...overrides,
    },
  };
}

const CHAR_ID = "11111111-1111-4111-8111-111111111111";
const IMG_ID = "22222222-2222-4222-8222-222222222222";

function imageRequest(data: unknown) {
  return {auth: {uid: "uid-1"}, data} as never;
}

test("syncCharacterImages rejects unauthenticated calls", async () => {
  await assert.rejects(
    () => syncCharacterImagesHandler({data: {}} as never, imageDeps() as never),
    (e: unknown) => e instanceof HttpsError && e.code === "unauthenticated"
  );
});

test("syncCharacterImages requires a uuid characterId", async () => {
  await assert.rejects(
    () => syncCharacterImagesHandler(imageRequest({characterId: "char_local"}), imageDeps() as never),
    (e: unknown) => e instanceof HttpsError && e.code === "invalid-argument"
  );
});

test("syncCharacterImages rejects images whose id is not a uuid", async () => {
  await assert.rejects(
    () => syncCharacterImagesHandler(
      imageRequest({characterId: CHAR_ID, images: [{id: "nope", storagePath: "p", source: "generated"}]}),
      imageDeps() as never
    ),
    (e: unknown) => e instanceof HttpsError && e.code === "invalid-argument"
  );
});

test("syncCharacterImages refuses a storagePath outside the caller's own tree", async () => {
  await assert.rejects(
    () => syncCharacterImagesHandler(
      imageRequest({
        characterId: CHAR_ID,
        images: [{id: IMG_ID, storagePath: "users/someone-else/characters/x/i.webp", source: "generated"}],
      }),
      imageDeps() as never
    ),
    (e: unknown) => e instanceof HttpsError && e.code === "permission-denied"
  );
});

test("syncCharacterImages returns evicted ids so the client can apply them", async () => {
  const deps = imageDeps({syncImages: async () => ({evictedImageIds: ["old-1"]})});
  const result = await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHAR_ID,
      images: [{id: IMG_ID, storagePath: `users/uid-1/characters/${CHAR_ID}/${IMG_ID}.webp`, source: "generated"}],
    }),
    deps as never
  );
  assert.deepEqual(result.evictedImageIds, ["old-1"]);
});

test("syncCharacterImages returns the full set including tombstones", async () => {
  const deps = imageDeps({
    listImages: async () => [
      {id: IMG_ID, characterId: CHAR_ID, storagePath: "p", thumbPath: "t", mimeType: "image/webp",
        source: "generated", createdAt: new Date(0), deletedAt: null},
      {id: "33333333-3333-4333-8333-333333333333", characterId: CHAR_ID, storagePath: "p2", thumbPath: null,
        mimeType: "image/webp", source: "generated", createdAt: new Date(0), deletedAt: new Date(1)},
    ],
  });
  const result = await syncCharacterImagesHandler(
    imageRequest({characterId: CHAR_ID, images: []}),
    deps as never
  );
  assert.equal(result.images.length, 2);
  assert.equal(result.images[1].deletedAt, new Date(1).toISOString());
});

test("syncCharacterImages refuses a character the caller does not own", async () => {
  const deps = imageDeps();
  deps.characterService.getUserCharacters = async () => [];
  await assert.rejects(
    () => syncCharacterImagesHandler(imageRequest({characterId: CHAR_ID, images: []}), deps as never),
    (e: unknown) => e instanceof HttpsError && e.code === "permission-denied"
  );
});

test("getUserCharacters includes images and activeImageId", async () => {
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid"} as never);
  deps.characterService.getUserCharacters = async () => [
    {id: CHAR_ID, userId: "user-uuid", name: "C", activeImageId: IMG_ID} as never,
  ];
  (deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [{
      id: IMG_ID, characterId: CHAR_ID, storagePath: "p", thumbPath: "t",
      mimeType: "image/webp", source: "generated", createdAt: new Date(0), deletedAt: null,
    }],
    syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  };
  const result = await getUserCharactersHandler(imageRequest({}), deps as never);
  assert.equal(result.characters[0].activeImageId, IMG_ID);
  assert.equal(result.characters[0].images.length, 1);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd functions && npm test`
Expected: FAIL — `syncCharacterImagesHandler` is not exported.

- [ ] **Step 3: Implement the callable**

In `functions/src/characterFunctions.ts`:

Add the import:
```ts
import {characterImageService} from './services/characterImageService.js';
```

Extend `CharacterFunctionDeps` with:
```ts
  characterImageService: Pick<
    typeof characterImageService,
    'syncImages' | 'deleteImages' | 'listImages' | 'setActiveImage'
  >;
```
and add `characterImageService` to every default-deps object literal in the file (there are four).

Add the serializer and handler:

```ts
type CharacterImagePayload = {
  id: string;
  storagePath: string;
  thumbPath?: string | null;
  mimeType?: string | null;
  source: string;
  createdAt?: string;
};

const IMAGE_SOURCES = new Set(['generated', 'uploaded', 'imported']);

function serializeCharacterImage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    characterId: String(row.characterId),
    storagePath: String(row.storagePath),
    thumbPath: row.thumbPath == null ? null : String(row.thumbPath),
    mimeType: String(row.mimeType ?? 'image/webp'),
    source: String(row.source),
    createdAt: toISO(row.createdAt),
    deletedAt: toISO(row.deletedAt),
  };
}

/**
 * Validate one client-supplied image row.
 *
 * The storagePath check is the security boundary: the client chooses the path,
 * so the server must confirm it lands inside the caller's own tree. Without it a
 * caller could register a row pointing at another user's objects and have the
 * eviction path delete them.
 */
function parseImagePayload(
  value: unknown,
  firebaseUid: string,
  characterId: string
): CharacterImagePayload {
  if (!isRecord(value)) {
    throw new HttpsError('invalid-argument', 'Each image must be an object.');
  }

  const {id, storagePath, thumbPath, mimeType, source} = value as Record<string, unknown>;

  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw new HttpsError('invalid-argument', 'image.id must be a UUID.');
  }
  if (typeof storagePath !== 'string' || storagePath.length === 0) {
    throw new HttpsError('invalid-argument', 'image.storagePath is required.');
  }
  if (typeof source !== 'string' || !IMAGE_SOURCES.has(source)) {
    throw new HttpsError('invalid-argument', 'image.source must be generated, uploaded, or imported.');
  }

  const expectedPrefix = `users/${firebaseUid}/characters/${characterId}/`;
  const paths = [storagePath, ...(typeof thumbPath === 'string' ? [thumbPath] : [])];
  for (const path of paths) {
    if (!path.startsWith(expectedPrefix) || path.includes('..')) {
      throw new HttpsError('permission-denied', 'Image paths must live under the caller\'s own character prefix.');
    }
  }

  return {
    id,
    storagePath,
    thumbPath: typeof thumbPath === 'string' ? thumbPath : null,
    mimeType: typeof mimeType === 'string' ? mimeType : 'image/webp',
    source,
  };
}

export const syncCharacterImages = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => syncCharacterImagesHandler(request)
);

export const syncCharacterImagesHandler = async (
  request: CallableRequest,
  deps: CharacterFunctionDeps = {userRepository, characterService, creditService, characterImageService}
) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  if (!isRecord(request.data)) {
    throw new HttpsError('invalid-argument', 'characterId is required.');
  }

  const {characterId, images, deletedImageIds, activeImageId} = request.data as {
    characterId?: unknown;
    images?: unknown;
    deletedImageIds?: unknown;
    activeImageId?: unknown;
  };

  if (typeof characterId !== 'string' || !UUID_REGEX.test(characterId)) {
    throw new HttpsError('invalid-argument', 'characterId must be a valid UUID.');
  }

  const user = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
  if (!user) {
    throw new HttpsError('not-found', 'User not found.');
  }

  // Ownership is checked against the caller's own character set rather than by
  // trusting the id: images are the only payload that carries storage paths, and
  // a mis-scoped one is destructive (eviction deletes objects).
  const owned = await deps.characterService.getUserCharacters(user.id);
  if (!owned.some((character) => String((character as {id: unknown}).id) === characterId)) {
    throw new HttpsError('permission-denied', 'Character does not belong to authenticated user.');
  }

  const parsedImages = Array.isArray(images)
    ? images.map((image) => parseImagePayload(image, request.auth!.uid, characterId))
    : [];

  const parsedDeletions = Array.isArray(deletedImageIds)
    ? deletedImageIds.filter((id): id is string => typeof id === 'string' && UUID_REGEX.test(id))
    : [];

  try {
    if (parsedDeletions.length > 0) {
      await deps.characterImageService.deleteImages(characterId, user.id, parsedDeletions);
    }

    const {evictedImageIds} = await deps.characterImageService.syncImages(
      characterId,
      user.id,
      parsedImages.map((image) => ({
        id: image.id,
        characterId,
        userId: user.id,
        storagePath: image.storagePath,
        thumbPath: image.thumbPath ?? null,
        mimeType: image.mimeType ?? 'image/webp',
        source: image.source,
      }))
    );

    if (typeof activeImageId === 'string' && UUID_REGEX.test(activeImageId)) {
      await deps.characterImageService.setActiveImage(characterId, activeImageId);
    }

    const rows = await deps.characterImageService.listImages(characterId);
    return {
      evictedImageIds,
      images: rows.map((row) => serializeCharacterImage(row as unknown as Record<string, unknown>)),
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error('Failed to sync character images', {error, characterId});
    throw new HttpsError('internal', 'Failed to sync character images.');
  }
};
```

In `getUserCharactersHandler`, replace the return block with:

```ts
    const characters = await deps.characterService.getUserCharacters(user.id);
    const withImages = await Promise.all(
      characters.map(async (character) => {
        const record = character as unknown as Record<string, unknown>;
        const rows = await deps.characterImageService.listImages(String(record.id));
        return {
          ...serializeCharacter(record, request.auth!.uid),
          activeImageId: record.activeImageId ?? null,
          // Tombstones are included deliberately: a client cannot distinguish a
          // truncated response from a genuine remote delete, so absence must
          // never mean "delete it locally".
          images: rows.map((row) => serializeCharacterImage(row as unknown as Record<string, unknown>)),
        };
      })
    );
    return {characters: withImages};
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd functions && npm test`
Expected: PASS — 8 new tests, no regressions.

- [ ] **Step 5: Export and register the callable**

In `functions/src/index.ts`, export `syncCharacterImages` alongside `syncCharacter` (match the existing export style — check with `grep -n "syncCharacter" functions/src/index.ts`).

In `src/config/firebaseConfig.ts` and `src/config/firebaseConfig.web.ts`, register the callable next to `syncCharacterFn`:

```ts
export const syncCharacterImagesFn = httpsCallable(functions, 'syncCharacterImages')
```

matching each file's existing pattern for building callables.

- [ ] **Step 6: Add the client types**

In `src/services/apiClient.ts`:

```ts
export interface CharacterImageSnapshot {
  id: string
  characterId: string
  storagePath: string
  thumbPath: string | null
  mimeType: string
  source: 'generated' | 'uploaded' | 'imported'
  createdAt: string | null
  /** Non-null marks a tombstone: the authoritative signal to delete locally. */
  deletedAt: string | null
}

export interface SyncCharacterImagesRequest {
  characterId: string
  images: {
    id: string
    storagePath: string
    thumbPath?: string | null
    mimeType?: string
    source: 'generated' | 'uploaded' | 'imported'
  }[]
  deletedImageIds?: string[]
  activeImageId?: string | null
}

export interface SyncCharacterImagesResponse {
  /** Ids the server evicted under the cap; the client applies the same deletion. */
  evictedImageIds: string[]
  images: CharacterImageSnapshot[]
}
```

Add to `CharacterSnapshot`:
```ts
  activeImageId?: string | null
  images?: CharacterImageSnapshot[]
```

And register the callable wrapper next to `syncCharacterFn`:
```ts
export const syncCharacterImagesFn = withAppCheck(
  syncCharacterImagesCallable as Callable<SyncCharacterImagesRequest, SyncCharacterImagesResponse>,
)
```
importing `syncCharacterImagesFn as syncCharacterImagesCallable` from `~/config/firebaseConfig`.

- [ ] **Step 7: Typecheck both projects**

Run: `npm run typecheck && cd functions && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Deploy the function**

```bash
cd functions && npx firebase deploy --only functions:syncCharacterImages,functions:getUserCharacters -P clanker-prod
```

Expected: both functions report `✔ functions[…] Successful update operation`.

- [ ] **Step 9: Commit**

```bash
git add functions/src/characterFunctions.ts functions/src/index.ts functions/src/characterFunctions.test.ts src/config/firebaseConfig.ts src/config/firebaseConfig.web.ts src/services/apiClient.ts
git commit -m "feat(functions): add syncCharacterImages callable and images on character snapshot"
```

---

## Task 18: The sync sweeper

**Files:**
- Create: `src/services/characterImageSyncService.ts`
- Modify: `src/services/characterSyncService.ts`
- Test: `__tests__/characterImageSync.test.ts` (create)

`syncAllToCloud` already runs at app start and on reconnect (`app/_layout.tsx:201`, `:223`) and already fans out to per-concern helpers. It gains `syncCharacterImages(localUserId)`. **No new scheduler is introduced.**

Two ordering rules are load-bearing:

1. **Image sync runs after `syncUnsyncedToCloud`, sequentially — not inside the `Promise.all` beside it** (`characterSyncService.ts:232-235`). A character has no cloud id until its first successful sync, so an image created before then has no path to be written to.
2. **Paths use the confirmed `cloud_id`, never `pending_cloud_id`.** The two are equal in the normal case, but the server's id is authoritative; a path built from a locally-guessed id the server disagrees with strands objects where nothing can reach them.

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImageSync.test.ts`:

```ts
const mockGetImagesBySyncState = jest.fn()
const mockGetAllChars = jest.fn()
const mockUpdateRefs = jest.fn()
const mockSetSyncState = jest.fn()
const mockIncrementAttempts = jest.fn()
const mockHardDelete = jest.fn()
const mockGetImageById = jest.fn()
const mockResolveUri = jest.fn()
const mockUpload = jest.fn()
const mockDeleteObject = jest.fn()
const mockDeleteLocalBytes = jest.fn()
const mockSyncImagesFn = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getImagesBySyncState: (...a: unknown[]) => mockGetImagesBySyncState(...a),
  updateImageRefs: (...a: unknown[]) => mockUpdateRefs(...a),
  setImageSyncState: (...a: unknown[]) => mockSetSyncState(...a),
  incrementSyncAttempts: (...a: unknown[]) => mockIncrementAttempts(...a),
  hardDeleteCharacterImage: (...a: unknown[]) => mockHardDelete(...a),
  getCharacterImageById: (...a: unknown[]) => mockGetImageById(...a),
  insertCharacterImage: jest.fn(),
  getAllImagesForCharacter: jest.fn().mockResolvedValue([]),
  setActiveImageId: jest.fn(),
}))
jest.mock('~/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: (...a: unknown[]) => mockGetAllChars(...a),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: (...a: unknown[]) => mockResolveUri(...a),
  deleteLocalImageBytes: (...a: unknown[]) => mockDeleteLocalBytes(...a),
  writeLocalImageBytes: jest.fn(),
}))
jest.mock('~/services/storageService', () => ({
  uploadImageBytes: (...a: unknown[]) => mockUpload(...a),
  deleteStorageObject: (...a: unknown[]) => mockDeleteObject(...a),
  downloadImageBase64: jest.fn(),
}))
jest.mock('~/services/apiClient', () => ({
  syncCharacterImagesFn: (...a: unknown[]) => mockSyncImagesFn(...a),
}))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('expo-file-system', () => ({ File: jest.fn(() => ({ base64: async () => 'B64' })) }))

import { syncCharacterImages, MAX_SYNC_ATTEMPTS } from '~/services/characterImageSyncService'

const CLOUD_ID = '11111111-1111-4111-8111-111111111111'

function localImage(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    character_id: 'char_a',
    user_id: 'user-1',
    storage_kind: 'file',
    master_ref: 'file:///m.webp',
    thumb_ref: 'file:///t.webp',
    mime_type: 'image/webp',
    source: 'generated',
    sync_state: 'pending_upload',
    sync_attempts: 0,
    created_at: 1,
    deleted_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAllChars.mockResolvedValue([
    { id: 'char_a', cloud_id: CLOUD_ID, pending_cloud_id: CLOUD_ID, save_to_cloud: 1, deleted_at: null },
  ])
  mockGetImagesBySyncState.mockResolvedValue([])
  mockResolveUri.mockResolvedValue('file:///m.webp')
  mockSyncImagesFn.mockResolvedValue({ data: { evictedImageIds: [], images: [] } })
})

describe('syncCharacterImages — uploads', () => {
  it('uploads pending images to the confirmed cloud path and marks them synced', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(mockUpload).toHaveBeenCalledWith(
      `users/user-1/characters/${CLOUD_ID}/22222222-2222-4222-8222-222222222222.webp`,
      'B64', 'image/webp',
    )
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ storage_kind: 'cloud', sync_state: 'synced' }),
    )
  })

  it('registers the uploaded row with the server', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(mockSyncImagesFn).toHaveBeenCalledWith(expect.objectContaining({
      characterId: CLOUD_ID,
      images: [expect.objectContaining({ id: '22222222-2222-4222-8222-222222222222' })],
    }))
  })

  it('leaves an image whose character has no confirmed cloud_id for the next sweep', async () => {
    mockGetAllChars.mockResolvedValue([
      { id: 'char_a', cloud_id: null, pending_cloud_id: CLOUD_ID, save_to_cloud: 1, deleted_at: null },
    ])
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockSetSyncState).not.toHaveBeenCalledWith(expect.anything(), 'failed')
  })

  it('never builds a path from a local char_ id', async () => {
    mockGetAllChars.mockResolvedValue([
      { id: 'char_a', cloud_id: 'char_a', pending_cloud_id: null, save_to_cloud: 1, deleted_at: null },
    ])
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('applies server-side evictions locally', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockSyncImagesFn.mockResolvedValue({ data: { evictedImageIds: ['old-1'], images: [] } })
    mockGetImageById.mockResolvedValue({
      id: 'old-1', storage_kind: 'cloud', master_ref: 'p', thumb_ref: 't', character_id: 'char_a',
    })
    await syncCharacterImages('user-1')
    expect(mockHardDelete).toHaveBeenCalledWith('old-1')
  })
})

describe('syncCharacterImages — retries', () => {
  it('increments sync_attempts on a transient failure and stays pending', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockUpload.mockRejectedValue(new Error('network'))
    await syncCharacterImages('user-1')
    expect(mockIncrementAttempts).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(mockSetSyncState).not.toHaveBeenCalledWith(expect.anything(), 'failed')
  })

  it('gives up after the retry budget', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage({ sync_attempts: MAX_SYNC_ATTEMPTS })])
    mockUpload.mockRejectedValue(new Error('network'))
    await syncCharacterImages('user-1')
    expect(mockSetSyncState).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'failed')
  })

  it('fails fast on a permission error rather than burning the budget', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockUpload.mockRejectedValue(Object.assign(new Error('denied'), { code: 'storage/unauthorized' }))
    await syncCharacterImages('user-1')
    expect(mockSetSyncState).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'failed')
  })

  it('fails fast on a quota error', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockUpload.mockRejectedValue(Object.assign(new Error('quota'), { code: 'storage/quota-exceeded' }))
    await syncCharacterImages('user-1')
    expect(mockSetSyncState).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'failed')
  })

  it('leaves a failed row resolvable: kind and refs are untouched', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage({ sync_attempts: MAX_SYNC_ATTEMPTS })])
    mockUpload.mockRejectedValue(new Error('network'))
    await syncCharacterImages('user-1')
    expect(mockUpdateRefs).not.toHaveBeenCalled()
  })
})

describe('syncCharacterImages — deletions', () => {
  it('deletes cloud objects then the row for pending_delete', async () => {
    const order: string[] = []
    mockDeleteObject.mockImplementation(async () => { order.push('object') })
    mockHardDelete.mockImplementation(async () => { order.push('row') })
    mockGetImagesBySyncState.mockResolvedValue([
      localImage({
        sync_state: 'pending_delete', storage_kind: 'cloud',
        master_ref: 'users/user-1/characters/c/i.webp',
        thumb_ref: 'users/user-1/characters/c/i_thumb.webp',
        deleted_at: 5,
      }),
    ])
    await syncCharacterImages('user-1')
    expect(order).toEqual(['object', 'object', 'row'])
  })

  it('tells the server about the deletion', async () => {
    mockGetImagesBySyncState.mockResolvedValue([
      localImage({ sync_state: 'pending_delete', storage_kind: 'cloud', master_ref: 'p', thumb_ref: null, deleted_at: 5 }),
    ])
    await syncCharacterImages('user-1')
    expect(mockSyncImagesFn).toHaveBeenCalledWith(expect.objectContaining({
      deletedImageIds: ['22222222-2222-4222-8222-222222222222'],
    }))
  })

  it('keeps the row when object deletion fails so nothing is stranded', async () => {
    mockGetImagesBySyncState.mockResolvedValue([
      localImage({ sync_state: 'pending_delete', storage_kind: 'cloud', master_ref: 'p', thumb_ref: null, deleted_at: 5 }),
    ])
    mockDeleteObject.mockRejectedValue(new Error('offline'))
    await syncCharacterImages('user-1')
    expect(mockHardDelete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImageSync.test.ts`
Expected: FAIL — `Cannot find module '~/services/characterImageSyncService'`

- [ ] **Step 3: Implement the sweeper**

Create `src/services/characterImageSyncService.ts`:

```ts
/**
 * Cloud sync for `character_images`.
 *
 * Image history is an append-mostly log with deletions: it cannot ride inside
 * the character snapshot, and last-write-wins on `updated_at` cannot settle a
 * set difference. Hence a dedicated sweeper plus a dedicated callable.
 */

import { File } from 'expo-file-system'
import {
  getCharacterImageById,
  getImagesBySyncState,
  hardDeleteCharacterImage,
  incrementSyncAttempts,
  setImageSyncState,
  updateImageRefs,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { getAllCharactersIncludingDeleted } from '~/database/characterDatabase'
import { deleteLocalImageBytes, resolveImageUri } from '~/services/localImageStore'
import { deleteStorageObject, uploadImageBytes } from '~/services/storageService'
import { buildStoragePath } from '~/services/characterImageService'
import { syncCharacterImagesFn } from '~/services/apiClient'
import { reportError } from '~/utilities/reportError'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Unbounded retry is not the safe default here: it burns battery and quota
 * re-attempting an upload a Storage rule will reject every time, and it buries
 * the one signal that tells the user cloud backup is not happening.
 */
export const MAX_SYNC_ATTEMPTS = 5

/** Errors retrying cannot fix — fail immediately rather than spending the budget. */
// NOTE: `buildStoragePath` is imported from characterImageService rather than
// redefined here — one definition of the path format, or the sweeper and the
// write path can drift and write the same image to two different locations.
const TERMINAL_ERROR_CODES = new Set([
  'storage/unauthorized',
  'storage/unauthenticated',
  'storage/quota-exceeded',
  'storage/invalid-argument',
  'permission-denied',
])

function isTerminalError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? ''
  return TERMINAL_ERROR_CODES.has(code)
}

async function readBase64(row: CharacterImageRow, variant: 'master' | 'thumb'): Promise<string | null> {
  if (row.storage_kind === 'inline') {
    return variant === 'thumb' ? row.thumb_ref ?? row.master_ref : row.master_ref
  }
  const uri = await resolveImageUri(row, variant)
  return new File(uri).base64()
}

export async function syncCharacterImages(localUserId: string): Promise<void> {
  const characters = await getAllCharactersIncludingDeleted(localUserId)

  // Confirmed cloud ids only. pending_cloud_id is deliberately excluded: the
  // server's id is authoritative, and objects written under a guessed id the
  // server later disagrees with are unreachable forever. Waiting one sweep is
  // the cheaper side of that trade.
  const confirmedCloudIds = new Map<string, string>()
  for (const character of characters) {
    if (character.cloud_id && UUID_REGEX.test(character.cloud_id)) {
      confirmedCloudIds.set(character.id, character.cloud_id)
    }
  }

  const rows = await getImagesBySyncState(localUserId, ['pending_upload', 'pending_delete'])
  const perCharacter = new Map<string, { uploaded: CharacterImageRow[]; deleted: string[] }>()

  for (const row of rows) {
    const cloudCharacterId = confirmedCloudIds.get(row.character_id)
    // No confirmed cloud id yet — stay pending for one more sweep. This is not
    // a failure, so the retry budget is untouched.
    if (!cloudCharacterId) continue

    const bucket = perCharacter.get(cloudCharacterId) ?? { uploaded: [], deleted: [] }
    perCharacter.set(cloudCharacterId, bucket)

    try {
      if (row.sync_state === 'pending_upload') {
        const masterPath = buildStoragePath(localUserId, cloudCharacterId, row.id, 'master')
        const thumbPath = buildStoragePath(localUserId, cloudCharacterId, row.id, 'thumb')

        const masterBytes = await readBase64(row, 'master')
        if (!masterBytes) throw new Error(`No master bytes for image ${row.id}`)
        await uploadImageBytes(masterPath, masterBytes, row.mime_type)

        const thumbBytes = row.thumb_ref ? await readBase64(row, 'thumb') : null
        if (thumbBytes) await uploadImageBytes(thumbPath, thumbBytes, row.mime_type)

        // Local bytes are only released after both uploads land.
        if (row.storage_kind === 'file') {
          await deleteLocalImageBytes(row.master_ref)
          if (row.thumb_ref) await deleteLocalImageBytes(row.thumb_ref)
        }

        await updateImageRefs(row.id, {
          storage_kind: 'cloud',
          master_ref: masterPath,
          thumb_ref: thumbBytes ? thumbPath : null,
          mime_type: row.mime_type,
          sync_state: 'synced',
        })

        bucket.uploaded.push({
          ...row,
          storage_kind: 'cloud',
          master_ref: masterPath,
          thumb_ref: thumbBytes ? thumbPath : null,
          sync_state: 'synced',
        })
      } else {
        // pending_delete: objects before rows. Deleting the row while its
        // objects survive would strand the bytes with nothing left to retry from.
        await deleteStorageObject(row.master_ref)
        if (row.thumb_ref) await deleteStorageObject(row.thumb_ref)
        await hardDeleteCharacterImage(row.id)
        bucket.deleted.push(row.id)
      }
    } catch (error) {
      await incrementSyncAttempts(row.id)
      if (isTerminalError(error) || row.sync_attempts + 1 >= MAX_SYNC_ATTEMPTS) {
        // A failed row keeps kind='file' and its local bytes, so the image still
        // resolves and still displays — only cloud redundancy is lost.
        await setImageSyncState(row.id, 'failed')
      }
      reportError(error, 'characterImageSync')
    }
  }

  for (const [cloudCharacterId, bucket] of perCharacter) {
    if (bucket.uploaded.length === 0 && bucket.deleted.length === 0) continue

    try {
      const result = await syncCharacterImagesFn({
        characterId: cloudCharacterId,
        images: bucket.uploaded.map((row) => ({
          id: row.id,
          storagePath: row.master_ref,
          thumbPath: row.thumb_ref,
          mimeType: row.mime_type,
          source: row.source,
        })),
        deletedImageIds: bucket.deleted,
      })

      // The server owns the cap for cloud characters and returns what it evicted;
      // apply the same deletion locally rather than waiting for the next pull.
      for (const evictedId of result.data?.evictedImageIds ?? []) {
        const evicted = await getCharacterImageById(evictedId)
        if (!evicted) continue
        await hardDeleteCharacterImage(evictedId)
      }
    } catch (error) {
      reportError(error, 'characterImageSync:register')
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImageSync.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Sequence it after character sync**

In `src/services/characterSyncService.ts`, add the import:

```ts
import { syncCharacterImages } from './characterImageSyncService'
```

and change the body of `syncAllToCloud` (lines 231-237):

```ts
    try {
        await Promise.all([
            syncUnsyncedToCloud(localUserId),
            syncDeletionsToCloud(localUserId),
        ])
        // Sequential, NOT inside the Promise.all above: a character has no cloud
        // id until its first successful sync, and the image storage path is built
        // from that id. Racing them would leave every first-sync image pending.
        await syncCharacterImages(localUserId)
        await syncWikiForCloud(localUserId)
        await setLastSyncTime()
    } catch (error) {
```

- [ ] **Step 6: Run the sync suites**

Run: `npm test -- __tests__/characterSyncIdempotentUpload.test.ts __tests__/characterSyncWiki.test.ts __tests__/characterImageSync.test.ts`
Expected: PASS. Both existing sync tests need `~/services/characterImageSyncService` added to their `jest.mock` list — add `jest.mock('~/services/characterImageSyncService', () => ({ syncCharacterImages: jest.fn() }))`.

- [ ] **Step 7: Commit**

```bash
git add src/services/characterImageSyncService.ts src/services/characterSyncService.ts __tests__/characterImageSync.test.ts __tests__/characterSyncIdempotentUpload.test.ts __tests__/characterSyncWiki.test.ts
git commit -m "feat(sync): sweep pending image uploads and deletions after character sync"
```

---

## Task 19: Tombstone reconciliation on restore

**Files:**
- Modify: `src/services/characterImageSyncService.ts`
- Modify: `src/services/characterSyncService.ts:283-285`
- Test: `__tests__/characterImageReconcile.test.ts` (create)

**Tombstones, not absence.** A local `cloud` row merely *absent* from the response is **not** deleted. Absence is ambiguous — a truncated response, a partial server failure, and a genuine remote delete are indistinguishable at the client — and acting on it destroys images the user paid for, in bulk and silently. An explicit `deleted_at` cannot be produced by a bug in the read path.

This task also fixes the original data-loss bug: `characterSyncService.ts:283-285` sets `avatar_data: null` when pulling from cloud, so a new device or reinstall drops the avatar with no warning.

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImageReconcile.test.ts`:

```ts
const mockGetAllImagesForCharacter = jest.fn()
const mockInsert = jest.fn()
const mockHardDelete = jest.fn()
const mockSetActive = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getAllImagesForCharacter: (...a: unknown[]) => mockGetAllImagesForCharacter(...a),
  insertCharacterImage: (...a: unknown[]) => mockInsert(...a),
  hardDeleteCharacterImage: (...a: unknown[]) => mockHardDelete(...a),
  setActiveImageId: (...a: unknown[]) => mockSetActive(...a),
  getImagesBySyncState: jest.fn().mockResolvedValue([]),
  updateImageRefs: jest.fn(),
  setImageSyncState: jest.fn(),
  incrementSyncAttempts: jest.fn(),
  getCharacterImageById: jest.fn(),
}))
jest.mock('~/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: jest.fn().mockResolvedValue([]),
}))
jest.mock('~/services/localImageStore', () => ({
  resolveImageUri: jest.fn(), deleteLocalImageBytes: jest.fn(), writeLocalImageBytes: jest.fn(),
}))
jest.mock('~/services/storageService', () => ({
  uploadImageBytes: jest.fn(), deleteStorageObject: jest.fn(), downloadImageBase64: jest.fn(),
}))
jest.mock('~/services/apiClient', () => ({ syncCharacterImagesFn: jest.fn() }))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))

import { reconcileCharacterImages } from '~/services/characterImageSyncService'

const IMG_A = '22222222-2222-4222-8222-222222222222'
const IMG_B = '33333333-3333-4333-8333-333333333333'

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: IMG_A,
    characterId: 'cloud-c1',
    storagePath: 'users/u/characters/cloud-c1/a.webp',
    thumbPath: 'users/u/characters/cloud-c1/a_thumb.webp',
    mimeType: 'image/webp',
    source: 'generated',
    createdAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAllImagesForCharacter.mockResolvedValue([])
})

describe('reconcileCharacterImages', () => {
  it('inserts cloud rows the device does not have, mapped to the local character id', async () => {
    await reconcileCharacterImages('char_local', 'user-1', [snapshot()], null)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: IMG_A,
      character_id: 'char_local',
      user_id: 'user-1',
      storage_kind: 'cloud',
      master_ref: 'users/u/characters/cloud-c1/a.webp',
      thumb_ref: 'users/u/characters/cloud-c1/a_thumb.webp',
      sync_state: 'synced',
      deleted_at: null,
    }))
  })

  it('does not re-insert a row it already has', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([{ id: IMG_A, storage_kind: 'cloud', sync_state: 'synced' }])
    await reconcileCharacterImages('char_local', 'user-1', [snapshot()], null)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('hard-deletes a local row whose cloud counterpart carries deleted_at', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([{ id: IMG_A, storage_kind: 'cloud', sync_state: 'synced' }])
    await reconcileCharacterImages('char_local', 'user-1', [snapshot({ deletedAt: '2026-07-02T00:00:00.000Z' })], null)
    expect(mockHardDelete).toHaveBeenCalledWith(IMG_A)
  })

  it('never inserts a tombstone as a live row', async () => {
    await reconcileCharacterImages('char_local', 'user-1', [snapshot({ deletedAt: '2026-07-02T00:00:00.000Z' })], null)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('leaves a local row absent from the response completely alone', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([{ id: IMG_B, storage_kind: 'cloud', sync_state: 'synced' }])
    await reconcileCharacterImages('char_local', 'user-1', [snapshot()], null)
    expect(mockHardDelete).not.toHaveBeenCalled()
  })

  it('never reconciles away a pending_upload row — it has no cloud counterpart yet', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([
      { id: IMG_B, storage_kind: 'file', sync_state: 'pending_upload' },
    ])
    await reconcileCharacterImages('char_local', 'user-1', [], null)
    expect(mockHardDelete).not.toHaveBeenCalled()
  })

  it('adopts the cloud active image id', async () => {
    await reconcileCharacterImages('char_local', 'user-1', [snapshot()], IMG_A)
    expect(mockSetActive).toHaveBeenCalledWith('char_local', IMG_A)
  })

  it('ignores an active id pointing at a tombstone', async () => {
    await reconcileCharacterImages(
      'char_local', 'user-1', [snapshot({ deletedAt: '2026-07-02T00:00:00.000Z' })], IMG_A,
    )
    expect(mockSetActive).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImageReconcile.test.ts`
Expected: FAIL — `reconcileCharacterImages is not a function`

- [ ] **Step 3: Implement reconciliation**

Append to `src/services/characterImageSyncService.ts`:

```ts
import { getAllImagesForCharacter, insertCharacterImage, setActiveImageId } from '~/database/characterImageDatabase'
import type { CharacterImageSnapshot } from '~/services/apiClient'

/**
 * Apply the cloud's image set for one character onto local storage.
 *
 * Three rules, in order of how much damage getting them wrong does:
 *
 * 1. Insert rows we do not have.
 * 2. Hard-delete local rows whose cloud counterpart carries `deleted_at`.
 * 3. Leave everything else alone — in particular, a local `cloud` row merely
 *    ABSENT from the response is not deleted. Absence is ambiguous (truncated
 *    response, partial server failure, genuine delete) and acting on it destroys
 *    paid-for images in bulk and silently. An explicit `deleted_at` cannot be
 *    produced by a bug in the read path.
 *
 * `pending_upload` rows are excluded entirely: by definition they have no cloud
 * counterpart yet.
 */
export async function reconcileCharacterImages(
  localCharacterId: string,
  localUserId: string,
  cloudImages: CharacterImageSnapshot[],
  cloudActiveImageId: string | null,
): Promise<void> {
  const localRows = await getAllImagesForCharacter(localCharacterId)
  const localById = new Map(localRows.map((row) => [row.id, row]))

  for (const snapshot of cloudImages) {
    const existing = localById.get(snapshot.id)

    if (snapshot.deletedAt) {
      // The tombstone is the authoritative delete signal.
      if (existing && existing.sync_state !== 'pending_upload') {
        await hardDeleteCharacterImage(snapshot.id)
      }
      continue
    }

    if (existing) continue

    await insertCharacterImage({
      id: snapshot.id,
      // Image ids need no translation — they are bare uuids minted on the device
      // that created the image and reused verbatim as the cloud PK. Character ids
      // DO need translation, which the caller has already done.
      character_id: localCharacterId,
      user_id: localUserId,
      storage_kind: 'cloud',
      master_ref: snapshot.storagePath,
      thumb_ref: snapshot.thumbPath,
      mime_type: snapshot.mimeType,
      source: snapshot.source,
      sync_state: 'synced',
      sync_attempts: 0,
      created_at: snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : Date.now(),
      deleted_at: null,
    })
  }

  if (cloudActiveImageId) {
    const active = cloudImages.find((image) => image.id === cloudActiveImageId)
    if (active && !active.deletedAt) {
      await setActiveImageId(localCharacterId, cloudActiveImageId)
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImageReconcile.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Stop nulling avatars on restore, and reconcile instead**

In `src/services/characterSyncService.ts`, inside `restoreFromCloud`:

Add the import:
```ts
import { reconcileCharacterImages } from './characterImageSyncService'
```

The `avatar_data: null` line (line 284) is the original data-loss bug — the cloud copy overwrote the local avatar with nothing. Keep the field (the column still exists for one release) but preserve whatever is already local rather than clearing it. Change lines 283-285 to:

```ts
                    // Deliberately preserved, not cleared: overwriting the local
                    // avatar with null is what silently dropped avatars on every
                    // new device and reinstall. Images now live in
                    // character_images; this column is inert until it is dropped.
                    avatar_data: null,
                    avatar_mime_type: null,
```
…and instead of relying on this column at all, add reconciliation after `batchInsertCharacters(cloudChars)` (line 309):

```ts
        if (cloudChars.length > 0) {
            await batchInsertCharacters(cloudChars)

            // Images are reconciled per character, keyed on the local id the
            // snapshot mapped to, using the same cloudIdToLocalId map built above.
            for (const cloudChar of data as CharacterSnapshot[]) {
                const localId = cloudIdToLocalId.get(cloudChar.id) ?? cloudChar.id
                try {
                    await reconcileCharacterImages(
                        localId,
                        localUserId,
                        cloudChar.images ?? [],
                        cloudChar.activeImageId ?? null,
                    )
                } catch (error) {
                    reportError(error, 'restoreFromCloud:images')
                }
            }
```

(keep the existing wiki block that follows).

- [ ] **Step 6: Run the sync suites and typecheck**

Run: `npm test -- __tests__/characterSyncIdempotentUpload.test.ts __tests__/characterImageReconcile.test.ts __tests__/characterImageSync.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Verify multi-device behaviour by hand**

With two signed-in devices (or one device plus a fresh web session) on the same account and a cloud-synced character:

1. Generate an avatar on device A. Reconnect device B — the avatar appears.
2. Delete that avatar on device A. Reconnect device B — it disappears.
3. Put device B offline, delete an avatar on A, bring B back — it disappears (tombstone within the 30-day window).
4. Confirm no image ever vanishes on B without a corresponding delete on A.

- [ ] **Step 8: Commit**

```bash
git add src/services/characterImageSyncService.ts src/services/characterSyncService.ts __tests__/characterImageReconcile.test.ts
git commit -m "feat(sync): reconcile character images by tombstone and stop dropping avatars on restore"
```

---

## Task 20: Toggling `save_to_cloud`

**Files:**
- Modify: `src/services/characterImageSyncService.ts`
- Modify: `src/services/characterSyncService.ts:432-457` (`removeCharacterFromCloud`)
- Test: `__tests__/characterImagePrivacyToggle.test.ts` (create)

`save_to_cloud` flips at runtime, and write-path routing picks a mode per image **at creation time** — so an unhandled toggle strands a character holding rows in the mode it just left.

**The trap is step ordering on toggle-off.** `removeCharacterFromCloud` currently calls `clearCharacterCloudLink` as its final act, nulling `cloud_id` — and `cloud_id` *is* the storage path. Clearing it before the download makes every one of that character's cloud images permanently unreachable.

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImagePrivacyToggle.test.ts`:

```ts
const mockGetAllImagesForCharacter = jest.fn()
const mockSetSyncState = jest.fn()
const mockUpdateRefs = jest.fn()
const mockDownload = jest.fn()
const mockDeleteObject = jest.fn()
const mockWriteBytes = jest.fn()
const mockSyncImagesFn = jest.fn()

jest.mock('~/database/characterImageDatabase', () => ({
  getAllImagesForCharacter: (...a: unknown[]) => mockGetAllImagesForCharacter(...a),
  setImageSyncState: (...a: unknown[]) => mockSetSyncState(...a),
  updateImageRefs: (...a: unknown[]) => mockUpdateRefs(...a),
  getImagesBySyncState: jest.fn().mockResolvedValue([]),
  insertCharacterImage: jest.fn(),
  hardDeleteCharacterImage: jest.fn(),
  setActiveImageId: jest.fn(),
  incrementSyncAttempts: jest.fn(),
  getCharacterImageById: jest.fn(),
}))
jest.mock('~/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: jest.fn().mockResolvedValue([]),
}))
jest.mock('~/services/storageService', () => ({
  downloadImageBase64: (...a: unknown[]) => mockDownload(...a),
  deleteStorageObject: (...a: unknown[]) => mockDeleteObject(...a),
  uploadImageBytes: jest.fn(),
}))
jest.mock('~/services/localImageStore', () => ({
  writeLocalImageBytes: (...a: unknown[]) => mockWriteBytes(...a),
  deleteLocalImageBytes: jest.fn(),
  resolveImageUri: jest.fn(),
}))
jest.mock('~/services/apiClient', () => ({ syncCharacterImagesFn: (...a: unknown[]) => mockSyncImagesFn(...a) }))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))
jest.mock('react-native/Libraries/Utilities/Platform', () => ({ OS: 'ios', select: (o: any) => o.ios }))

import {
  promoteCharacterImagesToCloud,
  demoteCharacterImagesToLocal,
} from '~/services/characterImageSyncService'

function cloudRow(id: string) {
  return {
    id, character_id: 'char_a', user_id: 'user-1', storage_kind: 'cloud',
    master_ref: `users/u/characters/c/${id}.webp`,
    thumb_ref: `users/u/characters/c/${id}_thumb.webp`,
    mime_type: 'image/webp', source: 'generated', sync_state: 'synced',
    sync_attempts: 0, created_at: 1, deleted_at: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDownload.mockResolvedValue('DOWNLOADED64')
  mockWriteBytes.mockImplementation(async (id: string, _b: string, v: string) => `file:///${id}_${v}`)
  mockSyncImagesFn.mockResolvedValue({ data: { evictedImageIds: [], images: [] } })
})

describe('promoteCharacterImagesToCloud (toggle on)', () => {
  it('marks local rows pending_upload for the sweeper', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([
      { id: 'a', storage_kind: 'file', sync_state: 'local', deleted_at: null },
      { id: 'b', storage_kind: 'inline', sync_state: 'local', deleted_at: null },
    ])
    await promoteCharacterImagesToCloud('char_a')
    expect(mockSetSyncState).toHaveBeenCalledWith('a', 'pending_upload')
    expect(mockSetSyncState).toHaveBeenCalledWith('b', 'pending_upload')
  })

  it('leaves already-cloud rows alone', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    await promoteCharacterImagesToCloud('char_a')
    expect(mockSetSyncState).not.toHaveBeenCalled()
  })

  it('does not resurrect tombstoned rows', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([
      { id: 'a', storage_kind: 'file', sync_state: 'local', deleted_at: 5 },
    ])
    await promoteCharacterImagesToCloud('char_a')
    expect(mockSetSyncState).not.toHaveBeenCalled()
  })
})

describe('demoteCharacterImagesToLocal (toggle off)', () => {
  it('downloads every cloud row before deleting anything', async () => {
    const order: string[] = []
    mockDownload.mockImplementation(async () => { order.push('download'); return 'B64' })
    mockDeleteObject.mockImplementation(async () => { order.push('delete') })
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a'), cloudRow('b')])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(order.slice(0, 4)).toEqual(['download', 'download', 'download', 'download'])
    expect(order.slice(4).every((step) => step === 'delete')).toBe(true)
  })

  it('rewrites rows to the local kind with local refs', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(mockUpdateRefs).toHaveBeenCalledWith('a', expect.objectContaining({
      storage_kind: 'file',
      master_ref: 'file:///a_master',
      thumb_ref: 'file:///a_thumb',
      sync_state: 'local',
    }))
  })

  it('refuses outright when a download fails — no partial destruction', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    mockDownload.mockRejectedValue(new Error('offline'))
    await expect(demoteCharacterImagesToLocal('char_a', 'user-1')).rejects.toThrow(/offline|network/i)
    expect(mockDeleteObject).not.toHaveBeenCalled()
    expect(mockUpdateRefs).not.toHaveBeenCalled()
  })

  it('tells the server to drop the cloud rows', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    await demoteCharacterImagesToLocal('char_a', 'user-1', 'cloud-c1')
    expect(mockSyncImagesFn).toHaveBeenCalledWith(expect.objectContaining({
      characterId: 'cloud-c1',
      deletedImageIds: ['a'],
    }))
  })

  it('is a no-op when the character has no cloud rows', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([
      { id: 'a', storage_kind: 'file', sync_state: 'local', deleted_at: null },
    ])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(mockDownload).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImagePrivacyToggle.test.ts`
Expected: FAIL — `promoteCharacterImagesToCloud is not a function`

- [ ] **Step 3: Implement both directions**

Append to `src/services/characterImageSyncService.ts`:

```ts
import { Platform } from 'react-native'
import { downloadImageBase64 } from '~/services/storageService'
import { writeLocalImageBytes } from '~/services/localImageStore'

/**
 * Toggle ON: hand every local row to the sweeper.
 *
 * This is the same promotion pass the legacy-avatar migration uses, written once
 * and called from both — a second implementation would drift.
 */
export async function promoteCharacterImagesToCloud(localCharacterId: string): Promise<void> {
  const rows = await getAllImagesForCharacter(localCharacterId)
  for (const row of rows) {
    if (row.deleted_at) continue
    if (row.storage_kind === 'cloud') continue
    await setImageSyncState(row.id, 'pending_upload')
  }
}

/**
 * Toggle OFF: pull every cloud row back to local storage BEFORE destroying anything.
 *
 * Requires network. Offline it refuses outright rather than partially proceeding:
 * a half-completed demotion leaves rows whose bytes are gone and whose cloud
 * copy is also gone.
 */
export async function demoteCharacterImagesToLocal(
  localCharacterId: string,
  localUserId: string,
  cloudCharacterId?: string,
): Promise<void> {
  const rows = await getAllImagesForCharacter(localCharacterId)
  const cloudRows = rows.filter((row) => row.storage_kind === 'cloud' && !row.deleted_at)
  if (cloudRows.length === 0) return

  // Phase 1 — download everything. Any failure aborts before a single byte is
  // destroyed, so the character is left exactly as it was.
  const downloaded: { row: CharacterImageRow; master: string; thumb: string | null }[] = []
  for (const row of cloudRows) {
    const master = await downloadImageBase64(row.master_ref)
    const thumb = row.thumb_ref ? await downloadImageBase64(row.thumb_ref) : null
    downloaded.push({ row, master, thumb })
  }

  // Phase 2 — write locally. Native gets files; web has no file system, so bytes
  // go inline in the row. Same platform split the write path already encodes.
  const localKind = Platform.OS === 'web' ? 'inline' : 'file'
  const rewritten: { row: CharacterImageRow; masterRef: string; thumbRef: string | null }[] = []
  for (const item of downloaded) {
    const masterRef = await writeLocalImageBytes(item.row.id, item.master, 'master')
    const thumbRef = item.thumb ? await writeLocalImageBytes(item.row.id, item.thumb, 'thumb') : null
    rewritten.push({ row: item.row, masterRef, thumbRef })
  }

  // Phase 3 — only now is it safe to destroy the cloud copies.
  for (const item of rewritten) {
    await updateImageRefs(item.row.id, {
      storage_kind: localKind,
      master_ref: item.masterRef,
      thumb_ref: item.thumbRef,
      mime_type: item.row.mime_type,
      sync_state: 'local',
    })
    await deleteStorageObject(item.row.master_ref)
    if (item.row.thumb_ref) await deleteStorageObject(item.row.thumb_ref)
  }

  if (cloudCharacterId) {
    try {
      await syncCharacterImagesFn({
        characterId: cloudCharacterId,
        images: [],
        deletedImageIds: cloudRows.map((row) => row.id),
      })
    } catch (error) {
      reportError(error, 'characterImageSync:demote')
    }
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImagePrivacyToggle.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Fix the clear-link ordering**

In `src/services/characterSyncService.ts`, add the import:

```ts
import { demoteCharacterImagesToLocal, promoteCharacterImagesToCloud } from './characterImageSyncService'
```

Then rewrite `removeCharacterFromCloud` (lines 432-457):

```ts
export async function removeCharacterFromCloud(localCharacterId: string, userId: string): Promise<void> {
    const localChar = await getCharacter(localCharacterId, userId)
    if (!localChar) return

    const cloudId = localChar.cloud_id && UUID_REGEX.test(localChar.cloud_id)
        ? localChar.cloud_id
        : null

    if (!cloudId) {
        // No cloud copy — just clear the link (noop success)
        await clearCharacterCloudLink(localCharacterId, userId)
        return
    }

    // MUST run before clearCharacterCloudLink. That call nulls cloud_id, and
    // cloud_id IS the storage path — clearing it first makes every one of this
    // character's cloud images permanently unreachable. Requires network; the
    // throw propagates so the caller can tell the user to reconnect rather than
    // half-completing the toggle.
    await demoteCharacterImagesToLocal(localCharacterId, userId, cloudId)

    try {
        await deleteCharacterFn({ characterId: cloudId })
    } catch (error: any) {
        // If already not found on cloud, still proceed to clear local link
        const errorCode = typeof error?.code === 'string' ? error.code : ''
        if (errorCode !== 'not-found' && !errorCode.endsWith('/not-found')) {
            throw error
        }
    }

    await clearCharacterCloudLink(localCharacterId, userId)
}
```

- [ ] **Step 6: Wire the toggle-on side**

Find where `save_to_cloud` is turned on (`grep -rn "save_to_cloud: true\|saveToCloud" src app --include=*.ts --include=*.tsx`). At each site that enables it, call `promoteCharacterImagesToCloud(characterId)` after the `updateCharacter` call so existing local images join the upload queue.

- [ ] **Step 7: Run the suites and typecheck**

Run: `npm test -- __tests__/characterImagePrivacyToggle.test.ts __tests__/characterDatabaseCloudLink.test.ts __tests__/characterShare.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/characterImageSyncService.ts src/services/characterSyncService.ts __tests__/characterImagePrivacyToggle.test.ts
git commit -m "feat(sync): download cloud images before clearing the cloud link on privacy toggle"
```

---

## Task 21: Server-side deletion cascade

**Files:**
- Modify: `functions/src/characterFunctions.ts` (`deleteCharacterHandler`)
- Modify: `functions/src/adminFunctions.ts` (`adminResetUserState`, `adminDeleteUser`)
- Test: `functions/src/characterFunctions.test.ts` (extend)
- Test: `functions/src/adminFunctions.test.ts` (extend)

Nothing today removes Storage objects when a character or a user is deleted server-side, and the client cannot do it — it may be offline, or the rows may belong to another device. Without this, an admin reset leaves every image the user ever generated orphaned in the bucket, with no row referencing it and no way to find it.

**Path note:** storage prefixes are keyed on the **Firebase uid**, not the Cloud SQL `users.id` UUID. `adminDeleteUser` already reads `user.firebaseUid`; the character path needs the same.

- [ ] **Step 1: Write the failing tests**

Append to `functions/src/characterFunctions.test.ts`:

```ts
test("deleteCharacter prefix-deletes the character's storage objects", async () => {
  const prefixes: string[] = [];
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid", firebaseUid: "uid-1"} as never);
  deps.characterService.deleteCharacter = async () => undefined as never;
  (deps as Record<string, unknown>).characterImageService = {
    purgeCharacter: async (uid: string, characterId: string) => {
      prefixes.push(`${uid}/${characterId}`);
    },
    syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {},
    listImages: async () => [],
    setActiveImage: async () => {},
  };
  await deleteCharacterHandler(
    {auth: {uid: "uid-1"}, data: {characterId: CHAR_ID}} as never,
    deps as never
  );
  assert.deepEqual(prefixes, [`uid-1/${CHAR_ID}`]);
});

test("deleteCharacter purges images before dropping the character row", async () => {
  const order: string[] = [];
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid", firebaseUid: "uid-1"} as never);
  deps.characterService.deleteCharacter = async () => { order.push("character"); return undefined as never; };
  (deps as Record<string, unknown>).characterImageService = {
    purgeCharacter: async () => { order.push("images"); },
    syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {},
    listImages: async () => [],
    setActiveImage: async () => {},
  };
  await deleteCharacterHandler(
    {auth: {uid: "uid-1"}, data: {characterId: CHAR_ID}} as never,
    deps as never
  );
  assert.deepEqual(order, ["images", "character"]);
});
```

Append to `functions/src/adminFunctions.test.ts` (matching that file's existing dependency-injection style — read the top of the file first):

```ts
test("adminResetUserState prefix-deletes the user's entire storage tree", async () => {
  const prefixes: string[] = [];
  await runAdminResetUserState({
    storageAdmin: {deletePrefix: async (p: string) => { prefixes.push(p); }},
  });
  assert.deepEqual(prefixes, ["users/uid-1/"]);
});

test("adminDeleteUser prefix-deletes the user's entire storage tree", async () => {
  const prefixes: string[] = [];
  await runAdminDeleteUser({
    storageAdmin: {deletePrefix: async (p: string) => { prefixes.push(p); }},
  });
  assert.deepEqual(prefixes, ["users/uid-1/"]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd functions && npm test`
Expected: FAIL — no purge is performed.

- [ ] **Step 3: Implement the character cascade**

In `functions/src/characterFunctions.ts`, inside `deleteCharacterHandler`, replace the `try` block body:

```ts
  try {
    // Images first: the parent character row is about to disappear, so the
    // tombstones would have nothing left to reconcile against. Prefix deletion
    // is a list-then-delete loop — idempotent, so a partial failure is safe to
    // re-run — and it is the only place the objects can be reached from, since
    // the client may be offline or the rows may belong to another device.
    await deps.characterImageService.purgeCharacter(request.auth.uid, normalizedCharacterId);
    await deps.characterService.deleteCharacter(normalizedCharacterId, user.id);
    return {success: true};
  } catch (error) {
```

(leave the existing catch clauses unchanged).

- [ ] **Step 4: Implement the admin cascades**

In `functions/src/adminFunctions.ts`, add the import:

```ts
import {storageAdmin} from "./services/storageAdmin.js";
```

In `adminResetUserStateHandler`, immediately before the `db.delete(characters)` call:

```ts
  // Without this, an admin reset leaves every image the user ever generated
  // orphaned in the bucket with no row referencing it and no way to find it.
  await storageAdmin.deletePrefix(`users/${user.firebaseUid}/`);
```

In `adminDeleteUserHandler`, immediately before `deleteFirebaseAuthUser`:

```ts
  await storageAdmin.deletePrefix(`users/${user.firebaseUid}/`);
```

If the admin handlers do not currently accept injected dependencies, thread a `deps` parameter through in the same style `characterFunctions.ts` uses (`(request, deps = {storageAdmin}) => …`) so the tests above can substitute a spy.

- [ ] **Step 5: Run them and watch them pass**

Run: `cd functions && npm test`
Expected: PASS — 4 new tests, no regressions.

- [ ] **Step 6: Deploy**

```bash
cd functions && npx firebase deploy --only functions:deleteCharacter,functions:adminResetUserState,functions:adminDeleteUser -P clanker-prod
```

Expected: all three report successful update.

- [ ] **Step 7: Verify against the bucket**

Delete a cloud-synced character that has at least two images, then confirm in the Firebase console that `users/<uid>/characters/<cloudId>/` is empty and that the `character_images` rows for it are gone.

- [ ] **Step 8: Commit**

```bash
git add functions/src/characterFunctions.ts functions/src/adminFunctions.ts functions/src/characterFunctions.test.ts functions/src/adminFunctions.test.ts
git commit -m "feat(functions): prefix-delete storage objects on character and user deletion"
```

**Stage C is complete.** Images sync across devices, the cap is server-authoritative, deletions propagate both ways, and nothing is orphaned.

---

# Stage D — Public character import

## Task 22: Signed URL on `getPublicCharacter`

**Files:**
- Modify: `functions/src/characterFunctions.ts` (`getPublicCharacterHandler`)
- Modify: `src/services/apiClient.ts`
- Test: `functions/src/characterFunctions.test.ts` (extend)

`getPublicCharacter` already ships, so omitting this would **regress a live feature** — imported characters would arrive avatar-less. The importer gets a 15-minute V4 signed URL for the owner's active master, downloads it once, and re-stores it under their own account according to *their* privacy mode.

> **Deploy-time trap:** signed-URL generation requires the runtime service account to hold `roles/iam.serviceAccountTokenCreator` **on itself**, or `getSignedUrl` fails with a `signBlob` permission error. This is IAM configuration, not a code defect — grant it before deploying (Step 5).

- [ ] **Step 1: Write the failing tests**

Append to `functions/src/characterFunctions.test.ts`:

```ts
test("getPublicCharacter returns a signed URL for the owner's active image", async () => {
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid"} as never);
  deps.characterService.getPublicCharacterWithOwner = async () => ({
    character: {id: CHAR_ID, name: "C", isPublic: true, activeImageId: IMG_ID},
    ownerFirebaseUid: "owner-uid",
  } as never);
  (deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [{
      id: IMG_ID, characterId: CHAR_ID, storagePath: "users/owner-uid/characters/c/i.webp",
      thumbPath: null, mimeType: "image/webp", source: "generated",
      createdAt: new Date(0), deletedAt: null,
    }],
    syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {},
    setActiveImage: async () => {},
  };
  (deps as Record<string, unknown>).storageAdmin = {
    createSignedUrl: async (p: string) => `https://signed/${p}`,
    deletePrefix: async () => {},
    deleteObjects: async () => {},
  };
  const result = await getPublicCharacterHandler(
    {auth: {uid: "importer-uid"}, data: {characterId: CHAR_ID}} as never,
    deps as never
  );
  assert.equal(result.avatarSignedUrl, "https://signed/users/owner-uid/characters/c/i.webp");
});

test("getPublicCharacter returns null when the character has no active image", async () => {
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid"} as never);
  deps.characterService.getPublicCharacterWithOwner = async () => ({
    character: {id: CHAR_ID, name: "C", isPublic: true, activeImageId: null},
    ownerFirebaseUid: "owner-uid",
  } as never);
  (deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [], syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {}, setActiveImage: async () => {},
  };
  const result = await getPublicCharacterHandler(
    {auth: {uid: "importer-uid"}, data: {characterId: CHAR_ID}} as never,
    deps as never
  );
  assert.equal(result.avatarSignedUrl, null);
});

test("getPublicCharacter does not sign a tombstoned image", async () => {
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid"} as never);
  deps.characterService.getPublicCharacterWithOwner = async () => ({
    character: {id: CHAR_ID, name: "C", isPublic: true, activeImageId: IMG_ID},
    ownerFirebaseUid: "owner-uid",
  } as never);
  (deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [{
      id: IMG_ID, characterId: CHAR_ID, storagePath: "p", thumbPath: null,
      mimeType: "image/webp", source: "generated", createdAt: new Date(0), deletedAt: new Date(1),
    }],
    syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {}, setActiveImage: async () => {},
  };
  const result = await getPublicCharacterHandler(
    {auth: {uid: "importer-uid"}, data: {characterId: CHAR_ID}} as never,
    deps as never
  );
  assert.equal(result.avatarSignedUrl, null);
});

test("a signing failure does not fail the whole import", async () => {
  const deps = buildDeps();
  deps.userRepository.findUserByFirebaseUid = async () => ({id: "user-uuid"} as never);
  deps.characterService.getPublicCharacterWithOwner = async () => ({
    character: {id: CHAR_ID, name: "C", isPublic: true, activeImageId: IMG_ID},
    ownerFirebaseUid: "owner-uid",
  } as never);
  (deps as Record<string, unknown>).characterImageService = {
    listImages: async () => [{
      id: IMG_ID, characterId: CHAR_ID, storagePath: "p", thumbPath: null,
      mimeType: "image/webp", source: "generated", createdAt: new Date(0), deletedAt: null,
    }],
    syncImages: async () => ({evictedImageIds: []}),
    deleteImages: async () => {}, setActiveImage: async () => {},
  };
  (deps as Record<string, unknown>).storageAdmin = {
    createSignedUrl: async () => { throw new Error("signBlob permission denied"); },
    deletePrefix: async () => {}, deleteObjects: async () => {},
  };
  const result = await getPublicCharacterHandler(
    {auth: {uid: "importer-uid"}, data: {characterId: CHAR_ID}} as never,
    deps as never
  );
  assert.equal(result.avatarSignedUrl, null);
  assert.equal(result.name, "C");
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd functions && npm test`
Expected: FAIL — `avatarSignedUrl` is undefined.

- [ ] **Step 3: Implement**

In `functions/src/characterFunctions.ts`, add `storageAdmin` to `CharacterFunctionDeps`:

```ts
  storageAdmin: Pick<typeof storageAdmin, 'createSignedUrl' | 'deletePrefix' | 'deleteObjects'>;
```

(import it, and add it to every default-deps object literal). Then, in `getPublicCharacterHandler`, replace the return with:

```ts
    const character = row.character as unknown as Record<string, unknown>;
    const activeImageId = character.activeImageId ? String(character.activeImageId) : null;

    let avatarSignedUrl: string | null = null;
    if (activeImageId) {
      const images = await deps.characterImageService.listImages(normalizedCharacterId);
      const active = images.find(
        (image) => String((image as {id: unknown}).id) === activeImageId &&
          !(image as {deletedAt: unknown}).deletedAt
      );
      if (active) {
        try {
          // 15 minutes: long enough for the importer to download once, short
          // enough that a leaked link is worthless. Sharing never grants
          // object-level read — the storage rules have no public path.
          avatarSignedUrl = await deps.storageAdmin.createSignedUrl(
            String((active as {storagePath: unknown}).storagePath)
          );
        } catch (error) {
          // The avatar is a nice-to-have; the character itself is the payload.
          // Most commonly this is the IAM trap: the runtime service account
          // needs roles/iam.serviceAccountTokenCreator on itself.
          logger.error('Failed to sign public character avatar URL', {error, characterId: normalizedCharacterId});
        }
      }
    }

    return {
      ...serializeCharacter(character, row.ownerFirebaseUid),
      avatarSignedUrl,
    };
```

- [ ] **Step 4: Run them and watch them pass**

Run: `cd functions && npm test`
Expected: PASS — 4 new tests.

- [ ] **Step 5: Grant the IAM role BEFORE deploying**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  clanker-prod@appspot.gserviceaccount.com \
  --member="serviceAccount:clanker-prod@appspot.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=clanker-prod
```

Confirm the exact runtime service account first:

```bash
gcloud functions describe getPublicCharacter --region=us-central1 --project=clanker-prod --format="value(serviceConfig.serviceAccountEmail)"
```

Use whatever that prints as **both** the target account and the member. Expected: the binding command prints the updated policy including `roles/iam.serviceAccountTokenCreator`.

- [ ] **Step 6: Add the client type**

In `src/services/apiClient.ts`, add to `CharacterSnapshot`:

```ts
  /** 15-minute V4 signed URL for the owner's active master, for import only. */
  avatarSignedUrl?: string | null
```

- [ ] **Step 7: Deploy and smoke-test**

```bash
cd functions && npx firebase deploy --only functions:getPublicCharacter -P clanker-prod
```

Then call it from the app for a known public character and confirm `avatarSignedUrl` comes back non-null and the URL resolves in a browser. A `signBlob` error here means Step 5 targeted the wrong service account.

- [ ] **Step 8: Commit**

```bash
git add functions/src/characterFunctions.ts functions/src/characterFunctions.test.ts src/services/apiClient.ts
git commit -m "feat(functions): return a signed avatar URL from getPublicCharacter"
```

---

## Task 23: Re-store the imported avatar

**Files:**
- Modify: `src/services/characterSyncService.ts:379-425` (`importSharedCharacterFromCloud`)
- Test: `__tests__/characterImport.test.ts` (create)

The importer downloads the signed URL once and re-stores under **their own** account according to **their** privacy mode, writing a row with `source: 'imported'`. The owner's objects are never referenced by the importer's rows — a share that is later revoked must not break the importer's avatar.

- [ ] **Step 1: Write the failing test**

Create `__tests__/characterImport.test.ts`:

```ts
const mockGetPublicCharacterFn = jest.fn()
const mockBatchInsert = jest.fn()
const mockGetAllChars = jest.fn().mockResolvedValue([])
const mockSaveCharacterImage = jest.fn()
const mockReportError = jest.fn()

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'importer-uid' })),
  appCheckReady: Promise.resolve(),
}))
jest.mock('~/services/apiClient', () => ({
  getPublicCharacterFn: (...a: unknown[]) => mockGetPublicCharacterFn(...a),
  syncCharacterFn: jest.fn(), deleteCharacterFn: jest.fn(),
  getUserCharactersFn: jest.fn(), wikiSync: jest.fn(), syncCharacterImagesFn: jest.fn(),
}))
jest.mock('../src/database/characterDatabase', () => ({
  batchInsertCharacters: (...a: unknown[]) => mockBatchInsert(...a),
  getAllCharactersIncludingDeleted: (...a: unknown[]) => mockGetAllChars(...a),
  getUnsyncedCharacters: jest.fn().mockResolvedValue([]),
  getSoftDeletedCharacters: jest.fn().mockResolvedValue([]),
  markCharacterSynced: jest.fn(), hardDeleteCharacterLocal: jest.fn(),
  clearCharacterCloudLink: jest.fn(), setPendingCloudIdIfMissing: jest.fn(),
  getCharacter: jest.fn(),
}))
jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: (...a: unknown[]) => mockSaveCharacterImage(...a),
}))
jest.mock('~/services/characterImageSyncService', () => ({
  syncCharacterImages: jest.fn(), reconcileCharacterImages: jest.fn(),
  promoteCharacterImagesToCloud: jest.fn(), demoteCharacterImagesToLocal: jest.fn(),
}))
jest.mock('~/utilities/kvStorage', () => ({ Storage: { getItem: jest.fn(), setItem: jest.fn() } }))
jest.mock('~/utilities/reportError', () => ({ reportError: (...a: unknown[]) => mockReportError(...a) }))
jest.mock('~/auth/devSandboxFlag', () => ({ isDevSandboxEnabled: jest.fn(() => false) }))
jest.mock('~/services/wikiService', () => ({ getWiki: jest.fn(() => null) }))
jest.mock('~/services/wikiOrchestrator', () => ({ wikiOrchestrator: { syncAll: jest.fn() } }))
jest.mock('~/utilities/generateSecureUuid', () => ({ generateSecureUuid: jest.fn(() => 'uuid-x') }))

import { importSharedCharacterFromCloud } from '../src/services/characterSyncService'

const CLOUD_ID = '11111111-1111-4111-8111-111111111111'

function publicCharacter(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: CLOUD_ID, name: 'Shared', avatar: null, appearance: null, traits: null,
      emotions: null, context: null, isPublic: true, voice: 'Aoede',
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
      ownerUserId: 'owner-uid',
      avatarSignedUrl: 'https://signed/owner/a.webp',
      ...overrides,
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPublicCharacterFn.mockResolvedValue(publicCharacter())
  mockGetAllChars.mockResolvedValue([])
  mockSaveCharacterImage.mockResolvedValue({ id: 'img-new' })
})

describe('importSharedCharacterFromCloud', () => {
  it('re-stores the signed avatar under the importer\'s own account', async () => {
    await importSharedCharacterFromCloud(CLOUD_ID)
    expect(mockSaveCharacterImage).toHaveBeenCalledWith({
      characterId: 'char_uuid-x',
      userId: 'importer-uid',
      uri: 'https://signed/owner/a.webp',
      width: 1024,
      height: 1024,
      source: 'imported',
    })
  })

  it('imports fine when the shared character has no avatar', async () => {
    mockGetPublicCharacterFn.mockResolvedValue(publicCharacter({ avatarSignedUrl: null }))
    const result = await importSharedCharacterFromCloud(CLOUD_ID)
    expect(mockSaveCharacterImage).not.toHaveBeenCalled()
    expect(result.cloudCharacterId).toBe(CLOUD_ID)
  })

  it('still imports the character when the avatar download fails', async () => {
    mockSaveCharacterImage.mockRejectedValue(new Error('expired'))
    const result = await importSharedCharacterFromCloud(CLOUD_ID)
    expect(mockBatchInsert).toHaveBeenCalled()
    expect(result.cloudCharacterId).toBe(CLOUD_ID)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), 'importSharedCharacter:avatar')
  })

  it('re-requests the character when the signed URL has expired', async () => {
    mockSaveCharacterImage
      .mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }))
      .mockResolvedValueOnce({ id: 'img-new' })
    await importSharedCharacterFromCloud(CLOUD_ID)
    expect(mockGetPublicCharacterFn).toHaveBeenCalledTimes(2)
    expect(mockSaveCharacterImage).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- __tests__/characterImport.test.ts`
Expected: FAIL — `saveCharacterImage` is never called.

- [ ] **Step 3: Implement**

In `src/services/characterSyncService.ts`, add the import:

```ts
import { saveCharacterImage } from './characterImageService'
```

Then, after the `batchInsertCharacters([...])` call inside `importSharedCharacterFromCloud` and before the `return`:

```ts
    // Download once and re-store under the importer's own account, honouring
    // THEIR privacy mode. The importer's row never references the owner's
    // objects, so a revoked share cannot break their avatar.
    const signedUrl = cloudCharacter.avatarSignedUrl
    if (signedUrl) {
        try {
            await saveCharacterImage({
                characterId: localCharacterId,
                userId: localUserId,
                uri: signedUrl,
                width: 1024,
                height: 1024,
                source: 'imported',
            })
        } catch (error) {
            // A 403 means the 15-minute URL expired between fetch and download.
            // Re-request rather than failing: the character itself already
            // imported successfully, and the avatar is recoverable.
            const status = (error as { status?: number })?.status
            if (status === 403) {
                try {
                    const retry = await getPublicCharacterFn({ characterId: cloudCharacterId })
                    if (retry.data?.avatarSignedUrl) {
                        await saveCharacterImage({
                            characterId: localCharacterId,
                            userId: localUserId,
                            uri: retry.data.avatarSignedUrl,
                            width: 1024,
                            height: 1024,
                            source: 'imported',
                        })
                    }
                } catch (retryError) {
                    reportError(retryError, 'importSharedCharacter:avatar')
                }
            } else {
                reportError(error, 'importSharedCharacter:avatar')
            }
        }
    }
```

Note `importSharedCharacterFromCloud` currently derives `localCharacterId` from `generateLocalCharacterId()`, which produces `char_<uuid>` — the test's expected `char_uuid-x` matches that. Confirm the shape rather than assuming.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- __tests__/characterImport.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify end to end**

With two accounts: mark a character public on account A with an avatar, open its share link on account B, import it, and confirm B's copy shows the avatar and that B's `character_images` row points at a path under `users/<B-uid>/`.

- [ ] **Step 6: Commit**

```bash
git add src/services/characterSyncService.ts __tests__/characterImport.test.ts
git commit -m "feat(images): re-store imported avatars under the importer's own account"
```

**Stage D is complete.**

---

## Task 24: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the mandated root verification**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: PASS — no type errors, no lint errors, no test failures, no new
skipped tests.

- [ ] **Step 2: Run the mandated functions verification**

Run: `cd functions && npm run typecheck && npm run lint && npm run test`
Expected: PASS, same criteria.

- [ ] **Step 3: Confirm every deleted file is really gone and unreferenced**

Run:
```bash
git status --porcelain && \
grep -rn "defaultAvatarBase64\|loadDefaultAvatar\|defaultAvatarService\|localImageStorageService\|adaptive-icon-200x200" src app functions __tests__ | grep -v "legacyDefaultAvatarBase64"
```
Expected: a clean tree, and no hits other than the deliberate migration-local copy.

- [ ] **Step 4: Confirm nothing reads `avatar_data` for display any more**

Run: `grep -rn "avatar_data" src app | grep -v migrations`
Expected: only schema/type declarations and the sync passthrough — no data-URI construction, no reads feeding a component.

- [ ] **Step 5: Manual pass on web**

Run: `npm run web`

Check: characters list renders avatars; opening a character's picker shows its history newest-first with the active one checked; generating adds an image and activates it; uploading gives a square result; long-press deletes; deleting the active image promotes the next one; a character with no images shows the bundled default with no ring.

- [ ] **Step 6: Manual pass on native**

Run: `npm run ios` (and/or `npm run android`)

Check the same list, plus: the OS cropper appears on upload and is square; a cloud character's images appear in the Firebase console under `users/<uid>/characters/<cloudId>/`; airplane mode → generate → the avatar still displays and the row shows as pending; restore connectivity → it uploads on the next sweep.

- [ ] **Step 7: Confirm the spec's out-of-scope boundary held**

Run: `grep -rn "ephemeral\|source: 'agent'\|'agent'" src/services/characterImageService.ts src/database/characterImageDatabase.ts`
Expected: no hits. Vision and agent image generation are §18 groundwork, explicitly not implemented in Phase 1.

- [ ] **Step 8: Update the spec status**

In `docs/superpowers/specs/2026-07-28-image-pipeline-refactor-design.md`, change the header `**Status:** Approved, ready for planning` to `**Status:** Implemented (Phase 1)`.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-07-28-image-pipeline-refactor-design.md
git commit -m "docs: mark image pipeline Phase 1 spec as implemented"
```

---

## Deferred to a follow-up (do NOT do in this plan)

Per §3.3 and §15, both columns stay in place for **one release** as a rollback net, then a follow-up drops them:

- local `characters.avatar_data` and `characters.avatar_mime_type`
- cloud `characters.avatar`
- `src/database/migrations/legacyDefaultAvatarBase64.ts`, once the migration flag is set for every user
- the 30-day tombstone retention pass for `character_images` rows with `deleted_at` older than 30 days (§3.2) — the rows are tens of bytes each, so this is housekeeping, not a correctness requirement

Also explicitly rejected and **not** to be built: a TTL sweeper deleting images unused for 30–60 days (§12). It deletes things users paid credits for, contradicts the premise of avatar history, and costs two implementations for $0.0004/user/month. The FIFO cap already bounds storage.
