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
jest.mock('~/services/apiClient', () => ({
  syncCharacterImagesFn: (...a: unknown[]) => mockSyncImagesFn(...a),
}))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('expo-file-system', () => ({ File: jest.fn() }))

import {
  promoteCharacterImagesToCloud,
  demoteCharacterImagesToLocal,
} from '~/services/characterImageSyncService'

function cloudRow(id: string) {
  return {
    id,
    character_id: 'char_a',
    user_id: 'user-1',
    storage_kind: 'cloud',
    master_ref: `users/u/characters/c/${id}.webp`,
    thumb_ref: `users/u/characters/c/${id}_thumb.webp`,
    mime_type: 'image/webp',
    source: 'generated',
    sync_state: 'synced',
    sync_attempts: 0,
    created_at: 1,
    deleted_at: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDownload.mockResolvedValue('DOWNLOADED64')
  mockWriteBytes.mockImplementation(
    async (id: string, _b: string, v: string) => `file:///${id}_${v}`,
  )
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
    mockDownload.mockImplementation(async () => {
      order.push('download')
      return 'B64'
    })
    mockDeleteObject.mockImplementation(async () => {
      order.push('delete')
    })
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a'), cloudRow('b')])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(order.slice(0, 4)).toEqual(['download', 'download', 'download', 'download'])
    expect(order.slice(4).every((step) => step === 'delete')).toBe(true)
  })

  it('rewrites rows to the local kind with local refs', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({
        storage_kind: 'file',
        master_ref: 'file:///a_master',
        thumb_ref: 'file:///a_thumb',
        sync_state: 'local',
      }),
    )
  })

  it('refuses outright when a download fails — no partial destruction', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    mockDownload.mockRejectedValue(new Error('offline'))
    await expect(demoteCharacterImagesToLocal('char_a', 'user-1')).rejects.toThrow(
      /offline|network/i,
    )
    expect(mockDeleteObject).not.toHaveBeenCalled()
    expect(mockUpdateRefs).not.toHaveBeenCalled()
  })

  it('tells the server to drop the cloud rows', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([cloudRow('a')])
    await demoteCharacterImagesToLocal('char_a', 'user-1', 'cloud-c1')
    expect(mockSyncImagesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'cloud-c1',
        deletedImageIds: ['a'],
      }),
    )
  })

  it('is a no-op when the character has no cloud rows', async () => {
    mockGetAllImagesForCharacter.mockResolvedValue([
      { id: 'a', storage_kind: 'file', sync_state: 'local', deleted_at: null },
    ])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('excludes reserved rows — their bytes may not exist yet', async () => {
    // A 'reserved' row is a claim made before its upload began; downloading it
    // here would throw on a plausibly-nonexistent object and abort the whole
    // demotion. It settles on its own (upload completion or the stale-
    // reservation reaper), same as it is excluded from the picker, the cap,
    // and the active pointer.
    mockGetAllImagesForCharacter.mockResolvedValue([
      { ...cloudRow('reserved-a'), sync_state: 'reserved' },
    ])
    await demoteCharacterImagesToLocal('char_a', 'user-1')
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockUpdateRefs).not.toHaveBeenCalled()
  })
})
