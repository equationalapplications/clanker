const mockReconcileCharacterImages = jest.fn()
const mockGetAllCharactersIncludingDeleted = jest.fn()
const mockBatchInsertCharacters = jest.fn()

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(() => ({ uid: 'user-1' })),
  appCheckReady: Promise.resolve(),
}))

jest.mock('../src/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: (...args: unknown[]) =>
    mockGetAllCharactersIncludingDeleted(...args),
  batchInsertCharacters: (...args: unknown[]) => mockBatchInsertCharacters(...args),
  getUnsyncedCharacters: jest.fn().mockResolvedValue([]),
  getSoftDeletedCharacters: jest.fn().mockResolvedValue([]),
  markCharacterSynced: jest.fn(),
  hardDeleteCharacterLocal: jest.fn(),
  clearCharacterCloudLink: jest.fn(),
  getCharacter: jest.fn(),
}))

jest.mock('~/utilities/kvStorage', () => ({
  Storage: { getItem: jest.fn(), setItem: jest.fn() },
}))
jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('~/auth/devSandboxFlag', () => ({ isDevSandboxEnabled: jest.fn(() => false) }))
jest.mock('~/services/wikiService', () => ({ getWiki: jest.fn(() => null) }))
jest.mock('~/services/wikiOrchestrator', () => ({ wikiOrchestrator: { syncAll: jest.fn() } }))
jest.mock('~/services/characterImageSyncService', () => ({
  syncCharacterImages: jest.fn(),
  reconcileCharacterImages: (...args: unknown[]) => mockReconcileCharacterImages(...args),
}))
jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: jest.fn(),
}))
jest.mock('~/services/apiClient', () => ({
  syncCharacterFn: jest.fn(),
  deleteCharacterFn: jest.fn(),
  getUserCharactersFn: jest.fn(),
  getPublicCharacterFn: jest.fn(),
  wikiSync: jest.fn(),
}))

import { restoreFromCloud } from '../src/services/characterSyncService'
import { getUserCharactersFn } from '~/services/apiClient'

const CLOUD_ID = '550e8400-e29b-41d4-a716-446655440000'
const LOCAL_ID = 'char-local-1'
const IMAGE_ID = '660e8400-e29b-41d4-a716-446655440000'

function cloudCharacter(overrides: Record<string, unknown> = {}) {
  return {
    id: CLOUD_ID,
    name: 'Restored',
    avatar: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    isPublic: false,
    createdAt: new Date(1000).toISOString(),
    updatedAt: new Date(2000).toISOString(),
    voice: null,
    images: [
      {
        id: IMAGE_ID,
        characterId: CLOUD_ID,
        storagePath: `users/u/characters/${CLOUD_ID}/${IMAGE_ID}.webp`,
        thumbPath: null,
        mimeType: 'image/webp',
        source: 'generated',
        createdAt: new Date(2000).toISOString(),
        deletedAt: null,
      },
    ],
    activeImageId: IMAGE_ID,
    ...overrides,
  }
}

function existingLocalChar(overrides: Record<string, unknown> = {}) {
  return {
    id: LOCAL_ID,
    user_id: 'user-1',
    cloud_id: CLOUD_ID,
    save_to_cloud: 1,
    deleted_at: null,
    name: 'Restored',
    avatar: null,
    avatar_data: null,
    avatar_mime_type: null,
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    is_public: 0,
    created_at: 1000,
    // Newer than the cloud snapshot's updatedAt (2000) so the character row
    // itself is filtered out of cloudChars — only its images changed.
    updated_at: 5000,
    synced_to_cloud: 1,
    summary_checkpoint: 0,
    owner_user_id: 'user-1',
    voice: null,
    ...overrides,
  }
}

describe('restoreFromCloud image reconciliation wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reconciles images even when the character row itself is not newer than local', async () => {
    ;(getUserCharactersFn as jest.Mock).mockResolvedValue({
      data: { characters: [cloudCharacter()] },
    })
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([existingLocalChar()])

    await restoreFromCloud('user-1')

    expect(mockBatchInsertCharacters).not.toHaveBeenCalled()
    expect(mockReconcileCharacterImages).toHaveBeenCalledWith(
      LOCAL_ID,
      'user-1',
      cloudCharacter().images,
      IMAGE_ID,
    )
  })
})
