const mockRunAsync = jest.fn()
const mockGetAllAsync = jest.fn().mockResolvedValue([])
const mockGetFirstAsync = jest.fn().mockResolvedValue(null)

const mockDb = {
  runAsync: mockRunAsync,
  getAllAsync: mockGetAllAsync,
  getFirstAsync: mockGetFirstAsync,
}

/** Swapped to a real better-sqlite3 handle by the integration suite below. */
let mockDbOverride: unknown = null

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(async () => mockDbOverride ?? mockDb),
}))

import { createExpoSqliteBetterSqlite3Mock } from './helpers/expoSqliteBetterSqlite3Mock'
import { CREATE_TABLES } from '../src/database/schema'
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
  mockDbOverride = null
  mockGetAllAsync.mockResolvedValue([])
  mockGetFirstAsync.mockResolvedValue(null)
})

describe('characterImageDatabase', () => {
  it('inserts every column of a row', async () => {
    await insertCharacterImage(row())
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toContain('INSERT INTO character_images')
    expect(params).toEqual([
      'img-1',
      'char_a',
      'user-1',
      'inline',
      'BASE64',
      null,
      'image/webp',
      'generated',
      'local',
      0,
      1000,
      null,
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
    expect(sql).toContain('JOIN characters c ON c.active_image_id = i.id AND i.character_id = c.id')
    expect(params).toEqual(['char_a'])
  })

  it('counts only live images', async () => {
    mockGetFirstAsync.mockResolvedValue({ count: 7 })
    await expect(countCharacterImages('char_a')).resolves.toBe(7)
    expect(mockGetFirstAsync.mock.calls[0][0]).toContain('deleted_at IS NULL')
  })

  it('counts zero when the count query returns no row', async () => {
    mockGetFirstAsync.mockResolvedValue(null)
    await expect(countCharacterImages('char_a')).resolves.toBe(0)
  })

  it('excludes the active image id from the eviction query', async () => {
    await getEvictionCandidates('char_a', 'img-active', 3)
    const [sql, params] = mockGetAllAsync.mock.calls[0]
    expect(sql).toContain('ORDER BY created_at ASC')
    expect(sql).toContain('AND id != ?')
    expect(params).toEqual(['char_a', 'img-active', 3])
  })

  it('returns no eviction candidates for a non-positive limit', async () => {
    await expect(getEvictionCandidates('char_a', 'img-active', 0)).resolves.toEqual([])
    await expect(getEvictionCandidates('char_a', 'img-active', -5)).resolves.toEqual([])
    expect(mockGetAllAsync).not.toHaveBeenCalled()
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

  it('updateImageRefs accepts a null thumb ref', async () => {
    await updateImageRefs('img-1', {
      storage_kind: 'file',
      master_ref: 'file:///img-1.webp',
      thumb_ref: null,
      mime_type: 'image/webp',
      sync_state: 'pending_upload',
    })
    const [, params] = mockRunAsync.mock.calls[0]
    expect(params).toEqual([
      'file',
      'file:///img-1.webp',
      null,
      'image/webp',
      'pending_upload',
      'img-1',
    ])
  })

  it('queries sweepable rows by state for one user', async () => {
    await getImagesBySyncState('user-1', ['pending_upload', 'pending_delete'])
    const [sql, params] = mockGetAllAsync.mock.calls[0]
    expect(sql).toContain('sync_state IN (?,?)')
    expect(params).toEqual(['user-1', 'pending_upload', 'pending_delete'])
  })

  it('setActiveImageId writes through to characters without bumping updated_at', async () => {
    await setActiveImageId('char_a', 'img-1')
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toBe('UPDATE characters SET active_image_id = ? WHERE id = ?')
    expect(sql).not.toContain('updated_at')
    expect(params).toEqual(['img-1', 'char_a'])
  })

  it('setActiveImageId can clear the pointer', async () => {
    await setActiveImageId('char_a', null)
    const [, params] = mockRunAsync.mock.calls[0]
    expect(params).toEqual([null, 'char_a'])
  })

  it('hard delete removes exactly one row by id', async () => {
    await hardDeleteCharacterImage('img-1')
    expect(mockRunAsync).toHaveBeenCalledWith('DELETE FROM character_images WHERE id = ?', [
      'img-1',
    ])
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

/**
 * The suite above mocks the database, so it cannot catch a column-name typo or
 * drift from the real schema. This one runs the same statements against an
 * in-memory SQLite built from CREATE_TABLES.
 */
describe('characterImageDatabase against the real schema', () => {
  let realDb: ReturnType<ReturnType<typeof createExpoSqliteBetterSqlite3Mock>['openDatabaseSync']>

  beforeAll(() => {
    realDb = createExpoSqliteBetterSqlite3Mock().openDatabaseSync(':memory:')
    realDb.execSync(CREATE_TABLES)
  })

  afterAll(() => {
    realDb.closeSync()
  })

  beforeEach(() => {
    mockDbOverride = realDb
  })

  function seedCharacter(id: string, updatedAt = 5000) {
    return realDb.runAsync(
      'INSERT INTO characters (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, 'user-1', id, 1000, updatedAt],
    )
  }

  function readUpdatedAt(id: string) {
    return realDb.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM characters WHERE id = ?',
      [id],
    )
  }

  it('round-trips insert, list, soft-delete and count', async () => {
    await insertCharacterImage(row({ id: 'img-old', created_at: 1000 }))
    await insertCharacterImage(row({ id: 'img-new', created_at: 2000 }))

    await expect(getCharacterImages('char_a')).resolves.toMatchObject([
      { id: 'img-new' },
      { id: 'img-old' },
    ])
    await expect(countCharacterImages('char_a')).resolves.toBe(2)

    await softDeleteCharacterImage('img-old', 'pending_delete')

    await expect(getCharacterImages('char_a')).resolves.toMatchObject([{ id: 'img-new' }])
    await expect(countCharacterImages('char_a')).resolves.toBe(1)
    await expect(getAllImagesForCharacter('char_a')).resolves.toHaveLength(2)
    await expect(getCharacterImageById('img-old')).resolves.toMatchObject({
      sync_state: 'pending_delete',
      deleted_at: expect.any(Number),
    })
  })

  it('sets, resolves and clears the active image pointer', async () => {
    await seedCharacter('char_active')
    await insertCharacterImage(row({ id: 'img-active', character_id: 'char_active' }))

    await setActiveImageId('char_active', 'img-active')
    await expect(getActiveCharacterImage('char_active')).resolves.toMatchObject({
      id: 'img-active',
      character_id: 'char_active',
    })

    await setActiveImageId('char_active', null)
    await expect(getActiveCharacterImage('char_active')).resolves.toBeNull()
  })

  it('setActiveImageId leaves the character updated_at untouched', async () => {
    await seedCharacter('char_stamp')
    await insertCharacterImage(row({ id: 'img-stamp', character_id: 'char_stamp' }))
    const before = await readUpdatedAt('char_stamp')

    await setActiveImageId('char_stamp', 'img-stamp')

    await expect(readUpdatedAt('char_stamp')).resolves.toEqual(before)
  })

  it('ignores an active image id owned by a different character', async () => {
    await seedCharacter('char_owner')
    await seedCharacter('char_thief')
    await insertCharacterImage(row({ id: 'img-owned', character_id: 'char_owner' }))

    await setActiveImageId('char_thief', 'img-owned')

    await expect(getActiveCharacterImage('char_thief')).resolves.toBeNull()
  })
})
