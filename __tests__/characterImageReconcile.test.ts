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

import { reconcileCharacterImages as reconcileCharacterImagesUntyped } from '~/services/characterImageSyncService'
import type { CharacterImageSnapshot } from '~/services/apiClient'

function reconcileCharacterImages(
  characterId: string,
  userId: string,
  images: unknown[],
  activeImageId: string | null,
) {
  return reconcileCharacterImagesUntyped(
    characterId,
    userId,
    images as CharacterImageSnapshot[],
    activeImageId,
  )
}

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
