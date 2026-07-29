const mockGetAllAsync = jest.fn()
const mockRunAsync = jest.fn()
const mockStorageGet = jest.fn()
const mockStorageSet = jest.fn()
const mockInsert = jest.fn()
const mockSetActive = jest.fn()
const mockGetImages = jest.fn().mockResolvedValue([])
const mockGetPendingThumbnails = jest.fn()
const mockUpdateRefs = jest.fn()
const mockPrepareVariants = jest.fn()
const mockPromoteToCloud = jest.fn()

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
  getInlineImagesMissingThumbForUser: (...a: unknown[]) => mockGetPendingThumbnails(...a),
  updateImageRefs: (...a: unknown[]) => mockUpdateRefs(...a),
}))
jest.mock('~/services/imageVariants', () => ({
  prepareImageVariants: (...a: unknown[]) => mockPrepareVariants(...a),
}))
jest.mock('~/utilities/generateSecureUuid', () => ({
  generateSecureUuid: jest.fn(() => 'uuid-mig'),
}))
// characterImageSyncService transitively pulls in native Firebase Storage
// modules via storageService — irrelevant to this migration's own logic and
// unparseable under this test's jest environment, so it is mocked at the
// boundary migrateAvatarsToImageStore actually calls through.
jest.mock('~/services/characterImageSyncService', () => ({
  promoteCharacterImagesToCloud: (...a: unknown[]) => mockPromoteToCloud(...a),
}))

import {
  migrateAvatarsToImageStore,
  sniffImageMimeType,
  backfillThumbnails,
  avatarMigrationFlagKey,
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
  mockGetPendingThumbnails.mockResolvedValue([])
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
    expect(mockStorageSet).toHaveBeenCalledWith(avatarMigrationFlagKey('user-1'), 'done')
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

  it('runs the background thumbnail pass on every row it just migrated', async () => {
    mockGetAllAsync.mockResolvedValue([charRow({ id: 'char_a' })])
    mockGetPendingThumbnails.mockResolvedValue([
      { id: 'uuid-mig', storage_kind: 'inline', master_ref: 'UklGRkkAAABXRUJQVlA4CUSTOM', thumb_ref: null, mime_type: 'image/webp', sync_state: 'local' },
    ])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    // §15 step 3: a migrated row has no thumb yet — the pass derives one so the
    // row does not resolve via the master fallback forever.
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      'uuid-mig',
      expect.objectContaining({ thumb_ref: 'NEWT' }),
    )
  })

  it('backfills thumbnails and promotes to cloud for a character an earlier, interrupted run already migrated', async () => {
    // Step 3 must not depend on what THIS pass inserted: a character already
    // holding gallery rows is skipped by the per-character idempotency check
    // below, so if step 3 were driven only from an in-memory list of rows this
    // pass just created, an interrupted prior run's characters would never get
    // their thumbnail backfilled or get promoted to cloud — silently, forever.
    mockGetAllAsync.mockResolvedValue([charRow({ id: 'char_a', save_to_cloud: 1 })])
    mockGetImages.mockResolvedValue([{ id: 'existing' }])
    mockGetPendingThumbnails.mockResolvedValue([
      { id: 'existing', storage_kind: 'inline', master_ref: 'X', thumb_ref: null, mime_type: 'image/webp', sync_state: 'local' },
    ])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdateRefs).toHaveBeenCalledWith('existing', expect.objectContaining({ thumb_ref: 'NEWT' }))
    expect(mockPromoteToCloud).toHaveBeenCalledWith('char_a')
  })

  it('promotes migrated rows to cloud for save_to_cloud characters', async () => {
    mockGetAllAsync.mockResolvedValue([charRow({ id: 'char_a', save_to_cloud: 1 })])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockPromoteToCloud).toHaveBeenCalledWith('char_a')
  })

  it('does not promote to cloud for a privacy-mode character', async () => {
    mockGetAllAsync.mockResolvedValue([charRow({ id: 'char_a', save_to_cloud: 0 })])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockPromoteToCloud).not.toHaveBeenCalled()
  })

  it('does not run the thumbnail pass for a skipped bundled-default row', async () => {
    // No row was ever created for this character, so there is nothing to
    // backfill. Promotion is still attempted per save_to_cloud character
    // (step 3 is driven by a fresh query, not by what this pass inserted — see
    // the interrupted-run recovery test above), but it is a harmless no-op in
    // production: promoteCharacterImagesToCloud finds no local rows to mark.
    mockGetAllAsync.mockResolvedValue([charRow({ avatar_data: DEFAULT_B64, save_to_cloud: 1 })])
    await migrateAvatarsToImageStore('user-1', DEFAULT_B64)
    expect(mockUpdateRefs).not.toHaveBeenCalled()
  })
})

describe('background thumbnail pass', () => {
  it('re-encodes PNG masters instead of relabelling them', async () => {
    mockGetAllAsync.mockResolvedValue([])
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
    await backfillThumbnails([
      { id: 'img-3', storage_kind: 'inline', master_ref: 'UklGRkk', thumb_ref: 'T', mime_type: 'image/webp' } as never,
    ])
    expect(mockPrepareVariants).not.toHaveBeenCalled()
  })
})