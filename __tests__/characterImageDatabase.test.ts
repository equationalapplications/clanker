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
    expect(sql).toContain('sync_state IN (?,?)')
    expect(params).toEqual(['user-1', 'pending_upload', 'pending_delete'])
  })

  it('setActiveImageId writes through to characters', async () => {
    await setActiveImageId('char_a', 'img-1')
    const [sql, params] = mockRunAsync.mock.calls[0]
    expect(sql).toContain('UPDATE characters SET active_image_id = ?')
    expect(params).toEqual(['img-1', expect.any(Number), 'char_a'])
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
