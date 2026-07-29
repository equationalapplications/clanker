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

const mockGetActiveImage = jest.fn().mockResolvedValue(null)
const mockGetStaleReservations = jest.fn()

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
  getActiveCharacterImage: (...a: unknown[]) => mockGetActiveImage(...a),
  getStaleImageReservations: (...a: unknown[]) => mockGetStaleReservations(...a),
}))
jest.mock('~/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: (...a: unknown[]) => mockGetAllChars(...a),
  getCharacter: jest.fn().mockResolvedValue(null),
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

import {
  syncCharacterImages,
  MAX_SYNC_ATTEMPTS,
  RESERVATION_STALE_MS,
} from '~/services/characterImageSyncService'

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
  // clearAllMocks drops recorded calls but KEEPS implementations, so the
  // rejecting/ordering stubs individual tests install leak into every later
  // test in the file. Reset the ones tests routinely override, or a case that
  // asserts "no upload cleanup happened" silently inherits a throwing upload
  // from the test above it and passes/fails for the wrong reason.
  for (const mock of [mockUpload, mockDeleteObject, mockDeleteLocalBytes, mockUpdateRefs]) {
    mock.mockReset()
    mock.mockResolvedValue(undefined)
  }
  mockGetAllChars.mockResolvedValue([
    { id: 'char_a', cloud_id: CLOUD_ID, pending_cloud_id: CLOUD_ID, save_to_cloud: 1, deleted_at: null },
  ])
  mockGetImagesBySyncState.mockResolvedValue([])
  mockResolveUri.mockResolvedValue('file:///m.webp')
  mockSyncImagesFn.mockResolvedValue({ data: { evictedImageIds: [], images: [] } })
  mockGetStaleReservations.mockResolvedValue([])
})

describe('syncCharacterImages — stale reservations', () => {
  it('deletes the objects a dead save reserved, then the row', async () => {
    const order: string[] = []
    mockDeleteObject.mockImplementation(async () => { order.push('object') })
    mockHardDelete.mockImplementation(async () => { order.push('row') })
    mockGetStaleReservations.mockResolvedValue([
      localImage({
        sync_state: 'reserved', storage_kind: 'cloud',
        master_ref: 'users/user-1/characters/c/i.webp',
        thumb_ref: 'users/user-1/characters/c/i_thumb.webp',
      }),
    ])

    await syncCharacterImages('user-1')

    // Objects before the row: the row is the only handle to those paths.
    expect(order).toEqual(['object', 'object', 'row'])
  })

  it('only considers reservations older than the stale window', async () => {
    await syncCharacterImages('user-1')
    const [, olderThan] = mockGetStaleReservations.mock.calls[0]
    expect(Date.now() - olderThan).toBeGreaterThanOrEqual(RESERVATION_STALE_MS)
  })

  it('keeps the row when object deletion fails, since it is the only record of the paths', async () => {
    mockGetStaleReservations.mockResolvedValue([
      localImage({ sync_state: 'reserved', storage_kind: 'cloud', master_ref: 'p', thumb_ref: null }),
    ])
    mockDeleteObject.mockRejectedValue(new Error('offline'))
    await syncCharacterImages('user-1')
    expect(mockHardDelete).not.toHaveBeenCalled()
  })
})

describe('syncCharacterImages — uploads', () => {
  it('uploads pending images to the confirmed cloud path', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(mockUpload).toHaveBeenCalledWith(
      `users/user-1/characters/${CLOUD_ID}/22222222-2222-4222-8222-222222222222.webp`,
      'B64', 'image/webp',
    )
    // Refs repointed at the cloud copies, but deliberately still pending: the
    // server has not acknowledged the row yet.
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ storage_kind: 'cloud', sync_state: 'pending_upload' }),
    )
  })

  it('marks the row synced only after the server acknowledges it', async () => {
    const order: string[] = []
    mockUpdateRefs.mockImplementation(async () => { order.push('updateRefs') })
    mockSyncImagesFn.mockImplementation(async () => {
      order.push('register')
      return { data: { evictedImageIds: [], images: [] } }
    })
    mockSetSyncState.mockImplementation(async (_id: string, state: string) => {
      order.push(`setState:${state}`)
    })
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(order).toEqual(['updateRefs', 'register', 'setState:synced'])
  })

  it('leaves the row pending when registration fails, so the next sweep retries it', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockSyncImagesFn.mockRejectedValue(new Error('offline'))
    await syncCharacterImages('user-1')
    // Never marked synced — that would drop it out of every future sweep, leaving
    // bytes in Storage the server never learns about.
    expect(mockSetSyncState).not.toHaveBeenCalledWith(expect.anything(), 'synced')
    expect(mockIncrementAttempts).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
  })

  it('gives up on registration after the retry budget', async () => {
    mockGetImagesBySyncState.mockResolvedValue([
      localImage({ sync_attempts: MAX_SYNC_ATTEMPTS - 1 }),
    ])
    mockSyncImagesFn.mockRejectedValue(new Error('offline'))
    await syncCharacterImages('user-1')
    expect(mockSetSyncState).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'failed')
  })

  it('re-registers an already-uploaded cloud row without re-uploading it', async () => {
    // A previous sweep uploaded the bytes and its registration call failed; the
    // local bytes are gone, so re-uploading is impossible as well as wasteful.
    mockGetImagesBySyncState.mockResolvedValue([
      localImage({
        storage_kind: 'cloud',
        sync_state: 'pending_upload',
        master_ref: `users/user-1/characters/${CLOUD_ID}/img.webp`,
        thumb_ref: null,
      }),
    ])
    await syncCharacterImages('user-1')
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockSyncImagesFn).toHaveBeenCalledWith(expect.objectContaining({
      images: [expect.objectContaining({ id: '22222222-2222-4222-8222-222222222222' })],
    }))
    expect(mockSetSyncState).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'synced')
  })

  it('persists the cloud refs before deleting local bytes (rows before local cleanup)', async () => {
    const order: string[] = []
    mockUpload.mockImplementation(async () => { order.push('upload') })
    mockUpdateRefs.mockImplementation(async () => { order.push('updateRefs') })
    mockDeleteLocalBytes.mockImplementation(async () => { order.push('deleteLocalBytes') })
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    await syncCharacterImages('user-1')
    expect(order).toEqual(['upload', 'upload', 'updateRefs', 'deleteLocalBytes', 'deleteLocalBytes'])
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

  it('deletes a master that uploaded before the thumb failed', async () => {
    // The row is still file-kind at this point, so nothing references the
    // uploaded master. Left behind it is an orphan no sweep can find once the
    // row exhausts its retry budget — the same class the write path's
    // reservation closes, which does not cover the sweeper.
    const masterPath = `users/user-1/characters/${CLOUD_ID}/22222222-2222-4222-8222-222222222222.webp`
    const thumbPath = `users/user-1/characters/${CLOUD_ID}/22222222-2222-4222-8222-222222222222_thumb.webp`
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockUpload.mockImplementation(async (path: string) => {
      if (path === thumbPath) throw new Error('network')
    })
    await syncCharacterImages('user-1')
    expect(mockDeleteObject).toHaveBeenCalledWith(masterPath)
    // The local bytes are untouched, so the image still resolves and a later
    // sweep re-uploads to the same deterministic path.
    expect(mockDeleteLocalBytes).not.toHaveBeenCalled()
    expect(mockUpdateRefs).not.toHaveBeenCalled()
  })

  it('keeps uploaded objects once the row commits to them', async () => {
    // After updateImageRefs the row points at the cloud copies, so a later
    // failure in the same iteration must not delete them.
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockDeleteLocalBytes.mockRejectedValue(new Error('fs gone'))
    await syncCharacterImages('user-1')
    expect(mockDeleteObject).not.toHaveBeenCalled()
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

  it('does not delete local bytes when updateImageRefs throws, and treats it as a transient failure', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage()])
    mockUpdateRefs.mockRejectedValue(new Error('db locked'))
    await syncCharacterImages('user-1')
    expect(mockDeleteLocalBytes).not.toHaveBeenCalled()
    expect(mockIncrementAttempts).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(mockSetSyncState).not.toHaveBeenCalledWith(expect.anything(), 'failed')
  })

  it('gives up after the retry budget when updateImageRefs keeps throwing', async () => {
    mockGetImagesBySyncState.mockResolvedValue([localImage({ sync_attempts: MAX_SYNC_ATTEMPTS })])
    mockUpdateRefs.mockRejectedValue(new Error('db locked'))
    await syncCharacterImages('user-1')
    expect(mockDeleteLocalBytes).not.toHaveBeenCalled()
    expect(mockSetSyncState).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', 'failed')
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
    mockSyncImagesFn.mockImplementation(async () => {
      order.push('register')
      return { data: { evictedImageIds: [], images: [] } }
    })
    await syncCharacterImages('user-1')
    // Row dropped only after the server acknowledged the deletion.
    expect(order).toEqual(['object', 'object', 'register', 'row'])
  })

  it('keeps the tombstone when registration fails, so the deletion is retryable', async () => {
    mockGetImagesBySyncState.mockResolvedValue([
      localImage({ sync_state: 'pending_delete', storage_kind: 'cloud', master_ref: 'p', thumb_ref: null, deleted_at: 5 }),
    ])
    mockSyncImagesFn.mockRejectedValue(new Error('offline'))
    await syncCharacterImages('user-1')
    // Hard-deleting here would leave the cloud row live, and the next reconcile
    // would re-insert the image the user just deleted.
    expect(mockHardDelete).not.toHaveBeenCalled()
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
