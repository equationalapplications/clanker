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
