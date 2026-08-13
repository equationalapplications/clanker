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
const mockWriteBytes = jest.fn(async (id: string, base64: string, variant: string) => {
  void base64
  return `file:///doc/${id}_${variant}`
})
const mockDeleteBytes = jest.fn()
const mockPrepareVariants = jest.fn()
const mockUploadImageBytes = jest.fn()
const mockDeleteStorageObject = jest.fn()
const mockUpdateImageRefs = jest.fn()
const mockIsDevSandboxEnabled = jest.fn().mockReturnValue(false)

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
  updateImageRefs: (...a: unknown[]) => mockUpdateImageRefs(...a),
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
jest.mock('~/services/storageService', () => ({
  uploadImageBytes: (...a: unknown[]) => mockUploadImageBytes(...a),
  deleteStorageObject: (...a: unknown[]) => mockDeleteStorageObject(...a),
}))
jest.mock('~/auth/devSandboxFlag', () => ({
  isDevSandboxEnabled: (...a: unknown[]) => mockIsDevSandboxEnabled(...a),
}))
// Mocking `react-native/Libraries/Utilities/Platform` directly breaks the
// jest-expo preset setup, so stub the public `react-native` surface instead.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

import {
  saveCharacterImage,
  deleteCharacterImage,
  deleteAllImagesForCharacter,
  IMAGE_CAP_PER_CHARACTER,
} from '~/services/characterImageService'

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks drops recorded calls but keeps implementations, so the
  // rejecting/ordering stubs installed by individual delete tests must be
  // reset explicitly or they leak into later suites.
  mockDeleteBytes.mockReset()
  mockHardDelete.mockReset()
  mockInsert.mockReset()
  mockUploadImageBytes.mockReset()
  mockUploadImageBytes.mockResolvedValue(undefined)
  mockDeleteStorageObject.mockReset()
  mockUpdateImageRefs.mockReset()
  mockWriteBytes.mockReset()
  mockWriteBytes.mockImplementation(async (id: string, base64: string, variant: string) => {
    void base64
    return `file:///doc/${id}_${variant}`
  })
  mockCount.mockResolvedValue(0)
  mockEvictionCandidates.mockResolvedValue([])
  mockGetActive.mockResolvedValue(null)
  mockGetAllForCharacter.mockResolvedValue([])
  mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: false, cloud_id: null })
  mockIsDevSandboxEnabled.mockReturnValue(false)
  mockPrepareVariants.mockResolvedValue({
    master: { base64: 'M64', mimeType: 'image/webp' },
    thumb: { base64: 'T64', mimeType: 'image/webp' },
  })
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
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'uploaded',
    })
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'uuid-new')
  })

  it('records the mime type the encoder actually produced', async () => {
    mockPrepareVariants.mockResolvedValue({
      master: { base64: 'M64', mimeType: 'image/jpeg' },
      thumb: { base64: 'T64', mimeType: 'image/jpeg' },
    })
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'uploaded',
    })
    expect(row.mime_type).toBe('image/jpeg')
  })

  it('does not evict below the cap', async () => {
    mockCount.mockResolvedValue(50)
    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
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
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
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
        characterId: 'nope',
        userId: 'user-1',
        uri: 'file://s.jpg',
        width: 500,
        height: 500,
        source: 'generated',
      }),
    ).rejects.toThrow(/character not found/i)
  })

  it('cleans up written bytes when the row insert fails', async () => {
    mockInsert.mockRejectedValue(new Error('database is locked'))
    await expect(
      saveCharacterImage({
        characterId: 'char_a',
        userId: 'user-1',
        uri: 'file://s.jpg',
        width: 500,
        height: 500,
        source: 'generated',
      }),
    ).rejects.toThrow('database is locked')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///doc/uuid-new_master')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///doc/uuid-new_thumb')
  })

  it('cleans up uploaded Storage objects when the commit write fails after a cloud upload', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    // The commit point on the cloud path is the finalize update, not the insert —
    // the insert already happened as the reservation, before any upload.
    mockUpdateImageRefs.mockRejectedValue(new Error('database is locked'))
    await expect(
      saveCharacterImage({
        characterId: 'char_a',
        userId: 'user-1',
        uri: 'file://s.jpg',
        width: 1024,
        height: 1024,
        source: 'generated',
      }),
    ).rejects.toThrow('database is locked')
    expect(mockDeleteStorageObject).toHaveBeenCalledWith(
      'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new.webp',
    )
    expect(mockDeleteStorageObject).toHaveBeenCalledWith(
      'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new_thumb.webp',
    )
    expect(mockDeleteBytes).not.toHaveBeenCalled()
    // The reservation is debris once its objects are gone.
    expect(mockHardDelete).toHaveBeenCalledWith('uuid-new')
  })

  it('uploads nothing when the reservation itself cannot be written', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    mockInsert.mockRejectedValue(new Error('database is locked'))
    await expect(
      saveCharacterImage({
        characterId: 'char_a',
        userId: 'user-1',
        uri: 'file://s.jpg',
        width: 1024,
        height: 1024,
        source: 'generated',
      }),
    ).rejects.toThrow('database is locked')
    // Reservation first means a failure here costs nothing: no bytes were sent.
    expect(mockUploadImageBytes).not.toHaveBeenCalled()
    expect(mockDeleteStorageObject).not.toHaveBeenCalled()
  })

  it('still resolves with the row when post-save bookkeeping fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockCount.mockRejectedValue(new Error('database is locked'))
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
    })
    expect(row.id).toBe('uuid-new')
    expect(mockInsert).toHaveBeenCalledWith(row)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('evicts nothing at exactly the cap', async () => {
    mockCount.mockResolvedValue(IMAGE_CAP_PER_CHARACTER)
    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
    })
    expect(mockEvictionCandidates).not.toHaveBeenCalled()
  })

  it('evicts exactly one image at one over the cap', async () => {
    mockCount.mockResolvedValue(IMAGE_CAP_PER_CHARACTER + 1)
    mockEvictionCandidates.mockResolvedValue([
      { id: 'old-1', storage_kind: 'inline', master_ref: 'B', thumb_ref: null },
    ])
    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
    })
    expect(mockEvictionCandidates).toHaveBeenCalledWith('char_a', null, 1)
    expect(mockHardDelete).toHaveBeenCalledTimes(1)
    expect(mockHardDelete).toHaveBeenCalledWith('old-1')
  })

  it('clears a bulk overage in a single pass', async () => {
    mockCount.mockResolvedValue(IMAGE_CAP_PER_CHARACTER + 5)
    mockEvictionCandidates.mockResolvedValue(
      ['old-1', 'old-2', 'old-3', 'old-4', 'old-5'].map((id) => ({
        id,
        storage_kind: 'inline',
        master_ref: 'B',
        thumb_ref: null,
      })),
    )
    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
    })
    expect(mockEvictionCandidates).toHaveBeenCalledWith('char_a', null, 5)
    expect(mockHardDelete).toHaveBeenCalledTimes(5)
  })

  it('never evicts a cloud-kind candidate locally — that cap is server-side', async () => {
    // Two devices can each hold fewer than 100 images while the cloud total
    // exceeds it, so a client-only cap cannot be correct for `cloud` rows (§13.3).
    // Hard-deleting one here would also race the sweeper's reconciliation.
    mockCount.mockResolvedValue(IMAGE_CAP_PER_CHARACTER + 1)
    mockEvictionCandidates.mockResolvedValue([
      {
        id: 'cloud-old',
        storage_kind: 'cloud',
        master_ref: 'users/u1/characters/c1/x.webp',
        thumb_ref: null,
      },
    ])
    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 500,
      height: 500,
      source: 'generated',
    })
    expect(mockHardDelete).not.toHaveBeenCalled()
    expect(mockSoftDelete).not.toHaveBeenCalled()
    expect(mockDeleteStorageObject).not.toHaveBeenCalled()
  })
})

describe('deleteCharacterImage', () => {
  it('deletes bytes before the row for a file image', async () => {
    const order: string[] = []
    mockDeleteBytes.mockImplementation(async () => {
      order.push('bytes')
    })
    mockHardDelete.mockImplementation(async () => {
      order.push('row')
    })
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'file',
      master_ref: 'file:///m',
      thumb_ref: 'file:///t',
    })
    await deleteCharacterImage('img-1', 'user-1')
    expect(order).toEqual(['bytes', 'bytes', 'row'])
  })

  it('leaves the row behind when byte deletion throws', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'file',
      master_ref: 'file:///m',
      thumb_ref: null,
    })
    mockDeleteBytes.mockRejectedValue(new Error('disk error'))
    await expect(deleteCharacterImage('img-1', 'user-1')).rejects.toThrow('disk error')
    expect(mockHardDelete).not.toHaveBeenCalled()
  })

  it('drops the row directly for inline images — the bytes are in the row', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'inline',
      master_ref: 'B64',
      thumb_ref: 'T64',
    })
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockDeleteBytes).not.toHaveBeenCalled()
    expect(mockHardDelete).toHaveBeenCalledWith('img-1')
  })

  it('promotes the next newest image to active when the active one is deleted', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'inline',
      master_ref: 'B',
      thumb_ref: null,
    })
    mockGetActive.mockResolvedValue({ id: 'img-1' })
    mockGetAllForCharacter.mockResolvedValue([
      { id: 'img-1', deleted_at: null, created_at: 3 },
      { id: 'img-0', deleted_at: null, created_at: 2 },
    ])
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'img-0')
  })

  it('skips a reserved row when promoting the next active image', async () => {
    // A 'reserved' row's bytes are not confirmed and the user has never seen
    // it — it must never become the active pointer, even if it is the newest
    // surviving row after a delete.
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'inline',
      master_ref: 'B',
      thumb_ref: null,
    })
    mockGetActive.mockResolvedValue({ id: 'img-1' })
    mockGetAllForCharacter.mockResolvedValue([
      { id: 'img-1', deleted_at: null, created_at: 3, sync_state: 'synced' },
      { id: 'img-reserved', deleted_at: null, created_at: 2.5, sync_state: 'reserved' },
      { id: 'img-0', deleted_at: null, created_at: 2, sync_state: 'synced' },
    ])
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockSetActive).toHaveBeenCalledWith('char_a', 'img-0')
  })

  it('clears the active image when the last one is deleted', async () => {
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'inline',
      master_ref: 'B',
      thumb_ref: null,
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

  it('soft-deletes a cloud row as pending_delete instead of hard-deleting it', async () => {
    // A cloud row has a server-side counterpart other devices reconcile against
    // (§13.3). Hard-deleting it here would let the next pull re-insert it, since
    // absence is not a tombstone — only an explicit deleted_at is. The sweeper
    // (characterImageSyncService) must be the one to reap the Storage objects
    // and the cloud row.
    mockGetById.mockResolvedValue({
      id: 'img-1',
      character_id: 'char_a',
      user_id: 'user-1',
      storage_kind: 'cloud',
      master_ref: 'users/u1/characters/c1/img-1.webp',
      thumb_ref: 'users/u1/characters/c1/img-1_thumb.webp',
    })
    await deleteCharacterImage('img-1', 'user-1')
    expect(mockSoftDelete).toHaveBeenCalledWith('img-1', 'pending_delete')
    expect(mockDeleteStorageObject).not.toHaveBeenCalled()
    expect(mockHardDelete).not.toHaveBeenCalled()
  })
})

describe('deleteAllImagesForCharacter', () => {
  it('cascades over every row including soft-deleted ones', async () => {
    mockGetAllForCharacter.mockResolvedValue([
      {
        id: 'a',
        character_id: 'char_a',
        user_id: 'user-1',
        storage_kind: 'file',
        master_ref: 'file:///a',
        thumb_ref: null,
      },
      {
        id: 'b',
        character_id: 'char_a',
        user_id: 'user-1',
        storage_kind: 'inline',
        master_ref: 'B',
        thumb_ref: null,
        deleted_at: 5,
      },
    ])
    await deleteAllImagesForCharacter('char_a', 'user-1')
    expect(mockDeleteBytes).toHaveBeenCalledWith('file:///a')
    expect(mockHardDelete).toHaveBeenCalledWith('a')
    expect(mockHardDelete).toHaveBeenCalledWith('b')
  })

  it('soft-deletes a cloud row rather than hard-deleting it directly', async () => {
    mockGetAllForCharacter.mockResolvedValue([
      {
        id: 'c',
        character_id: 'char_a',
        user_id: 'user-1',
        storage_kind: 'cloud',
        master_ref: 'users/u1/characters/c1/c.webp',
        thumb_ref: null,
      },
    ])
    await deleteAllImagesForCharacter('char_a', 'user-1')
    expect(mockSoftDelete).toHaveBeenCalledWith('c', 'pending_delete')
    expect(mockHardDelete).not.toHaveBeenCalledWith('c')
  })
})

describe('cloud routing', () => {
  it('uploads and stores object paths for a cloud character, leaving registration to the sweeper', async () => {
    // `synced` means "the server knows about this row" — true only after
    // `syncCharacterImagesFn` acknowledges the row on the next sweep. Until
    // then the row stays `pending_upload` so the sweeper picks it up and
    // registers it; marking it `synced` here would drop it out of every
    // future sweep and leave other devices with no Postgres row to restore
    // from, even though the Storage objects exist.
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(mockUploadImageBytes).toHaveBeenCalledWith(
      'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new.webp',
      'M64',
      'image/webp',
    )
    expect(mockUploadImageBytes).toHaveBeenCalledWith(
      'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new_thumb.webp',
      'T64',
      'image/webp',
    )
    expect(row).toMatchObject({
      storage_kind: 'cloud',
      master_ref: 'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new.webp',
      thumb_ref: 'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new_thumb.webp',
      sync_state: 'pending_upload',
    })
  })

  it('keeps the image locally as pending_upload when the upload fails', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    mockUploadImageBytes.mockRejectedValue(new Error('network down'))
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(row).toMatchObject({ storage_kind: 'file', sync_state: 'pending_upload' })
    // The reservation row is updated into its final shape rather than re-inserted.
    expect(mockUpdateImageRefs).toHaveBeenCalledWith(
      'uuid-new',
      expect.objectContaining({
        storage_kind: 'file',
        sync_state: 'pending_upload',
      }),
    )
  })

  it('reserves a durable row before the first upload, then finalizes it', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    const order: string[] = []
    mockInsert.mockImplementation(async (row: { sync_state: string }) => {
      order.push(`insert:${row.sync_state}`)
    })
    mockUploadImageBytes.mockImplementation(async () => {
      order.push('upload')
    })
    mockUpdateImageRefs.mockImplementation(async (_id: string, refs: { sync_state: string }) => {
      order.push(`finalize:${refs.sync_state}`)
    })

    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })

    // The reservation names the object paths before any byte is written, so a
    // process killed mid-upload still leaves something that can find them.
    // After both uploads land, the row is finalized as `pending_upload` — the
    // sweeper will register it with the server on the next pass and only then
    // promote it to `synced`.
    expect(order).toEqual(['insert:reserved', 'upload', 'upload', 'finalize:pending_upload'])
  })

  it('names the real storage paths on the reservation row', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_state: 'reserved',
        storage_kind: 'cloud',
        master_ref: 'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new.webp',
        thumb_ref:
          'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new_thumb.webp',
      }),
    )
  })

  it('drops the reservation when the save fails outright', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    mockUploadImageBytes.mockRejectedValue(new Error('network down'))
    // Fallback to local also fails, so the whole save throws.
    mockWriteBytes.mockRejectedValue(new Error('disk full'))

    await expect(
      saveCharacterImage({
        characterId: 'char_a',
        userId: 'user-1',
        uri: 'file://s.jpg',
        width: 1024,
        height: 1024,
        source: 'generated',
      }),
    ).rejects.toThrow('disk full')

    // Objects are cleaned up, so the reservation has nothing left to point at.
    expect(mockHardDelete).toHaveBeenCalledWith('uuid-new')
  })

  it('does not insert a second row when falling back to local storage', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    mockUploadImageBytes.mockRejectedValue(new Error('network down'))
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    // One insert (the reservation); the fallback updates it rather than
    // inserting again, which would violate the primary key.
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockUpdateImageRefs).toHaveBeenCalledWith(
      'uuid-new',
      expect.objectContaining({
        storage_kind: 'file',
        sync_state: 'pending_upload',
      }),
    )
    expect(row).toMatchObject({ storage_kind: 'file', sync_state: 'pending_upload' })
  })

  it('deletes an already-uploaded master when the thumb upload fails', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    // Master succeeds, thumb fails — the row then falls back to local storage and
    // commits successfully, so nothing later would ever clean up that master.
    mockUploadImageBytes
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network down'))

    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })

    expect(row).toMatchObject({ storage_kind: 'file', sync_state: 'pending_upload' })
    expect(mockDeleteStorageObject).toHaveBeenCalledWith(
      'users/user-1/characters/12345678-1234-4123-8123-123456789abc/uuid-new.webp',
    )
    // Only the master landed, so only the master is cleaned up.
    expect(mockDeleteStorageObject).toHaveBeenCalledTimes(1)
  })

  it('stays pending_upload when the character has no confirmed cloud_id yet', async () => {
    mockGetCharacter.mockResolvedValue({ id: 'char_a', save_to_cloud: true, cloud_id: null })
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(mockUploadImageBytes).not.toHaveBeenCalled()
    expect(row.sync_state).toBe('pending_upload')
  })

  it('ignores a non-uuid cloud_id rather than building an unreachable path', async () => {
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: 'char_local_x',
    })
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(mockUploadImageBytes).not.toHaveBeenCalled()
    expect(row.sync_state).toBe('pending_upload')
  })

  it('skips the cloud upload entirely in the dev sandbox, even for a cloud character', async () => {
    // Storage rules deny the mock user (403) and the sweeper would retry the
    // failed rows forever, so the sandbox writes the local copy directly. The
    // row still lands as pending_upload, but syncAllToCloud is itself
    // sandbox-gated, so nothing ever sweeps it there.
    mockIsDevSandboxEnabled.mockReturnValue(true)
    mockGetCharacter.mockResolvedValue({
      id: 'char_a',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })
    const row = await saveCharacterImage({
      characterId: 'char_a',
      userId: 'user-1',
      uri: 'file://s.jpg',
      width: 1024,
      height: 1024,
      source: 'generated',
    })
    expect(mockUploadImageBytes).not.toHaveBeenCalled()
    // No reservation either — the local path commits the row in a single insert.
    expect(mockUpdateImageRefs).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(row)
    expect(row).toMatchObject({
      storage_kind: 'file',
      master_ref: 'file:///doc/uuid-new_master',
      thumb_ref: 'file:///doc/uuid-new_thumb',
      sync_state: 'pending_upload',
    })
  })
})

describe('chat photos', () => {
  it('does not become the active avatar', async () => {
    await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
    })

    expect(mockSetActive).not.toHaveBeenCalled()
  })

  it('still promotes an uploaded avatar to active', async () => {
    await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///avatar.jpg',
      width: 1024,
      height: 1024,
      source: 'uploaded',
    })

    expect(mockSetActive).toHaveBeenCalledWith('char-1', expect.any(String))
  })

  it('writes message_id onto the row', async () => {
    const row = await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
    })

    expect(row.message_id).toBe('msg-1')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'chat', message_id: 'msg-1' }),
    )
  })

  it('honours a caller-supplied imageId so the message can carry it beforehand', async () => {
    const row = await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
      imageId: '22222222-2222-4222-8222-222222222222',
    })

    expect(row.id).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('reuses caller-supplied variants instead of re-encoding', async () => {
    const variants = {
      master: { base64: 'MASTER', mimeType: 'image/webp' },
      thumb: { base64: 'THUMB', mimeType: 'image/webp' },
    }

    await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
      variants,
    })

    expect(mockPrepareVariants).not.toHaveBeenCalled()
  })

  it('leaves a cloud-backed chat photo in pending_upload so the sweeper registers it', async () => {
    // A successful cloud upload puts bytes in Storage but Postgres has no row
    // yet — `synced` means "the server knows about this row", which is only
    // true after `syncCharacterImagesFn` acknowledges the row. Marking the row
    // `synced` here would drop it out of every future sweep (the sweeper only
    // queries `pending_*` states) and leave other devices unable to restore
    // the chat bubble from the row.
    mockGetCharacter.mockResolvedValue({
      id: 'char-1',
      save_to_cloud: true,
      cloud_id: '12345678-1234-4123-8123-123456789abc',
    })

    const row = await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
    })

    expect(mockUploadImageBytes).toHaveBeenCalledTimes(2)
    expect(row).toMatchObject({
      storage_kind: 'cloud',
      source: 'chat',
      message_id: 'msg-1',
      sync_state: 'pending_upload',
    })
  })
})
