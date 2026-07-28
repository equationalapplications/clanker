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
