const mockGetCurrentUser = jest.fn()
const mockGetPublicCharacterFn = jest.fn()
const mockGetAllCharactersIncludingDeleted = jest.fn()
const mockBatchInsertCharacters = jest.fn()

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}))

jest.mock('~/services/apiClient', () => ({
  getPublicCharacterFn: (...args: unknown[]) => mockGetPublicCharacterFn(...args),
}))

jest.mock('~/database/characterDatabase', () => ({
  getAllCharactersIncludingDeleted: (...args: unknown[]) =>
    mockGetAllCharactersIncludingDeleted(...args),
  batchInsertCharacters: (...args: unknown[]) => mockBatchInsertCharacters(...args),
}))

import { importSharedCharacterFromCloud } from '../src/services/characterSyncService'

describe('importSharedCharacterFromCloud voice normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCurrentUser.mockReturnValue({ uid: 'user-1' })
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([])
  })

  it('trims imported voice before local insert', async () => {
    mockGetPublicCharacterFn.mockResolvedValue({
      data: {
        id: 'cloud-1',
        name: 'Shared Character',
        avatar: null,
        appearance: null,
        traits: null,
        emotions: null,
        context: null,
        voice: '  Kore  ',
        isPublic: true,
        createdAt: '2026-04-26T00:00:00.000Z',
        updatedAt: '2026-04-26T00:00:00.000Z',
        ownerUserId: 'owner-1',
      },
    })

    await importSharedCharacterFromCloud('cloud-1', 'user-1')

    expect(mockBatchInsertCharacters).toHaveBeenCalledTimes(1)
    const inserted = mockBatchInsertCharacters.mock.calls[0][0][0]
    expect(inserted.voice).toBe('Kore')
  })

  it('defaults blank imported voice to Umbriel', async () => {
    mockGetPublicCharacterFn.mockResolvedValue({
      data: {
        id: 'cloud-1',
        name: 'Shared Character',
        avatar: null,
        appearance: null,
        traits: null,
        emotions: null,
        context: null,
        voice: '   ',
        isPublic: true,
        createdAt: '2026-04-26T00:00:00.000Z',
        updatedAt: '2026-04-26T00:00:00.000Z',
        ownerUserId: 'owner-1',
      },
    })

    await importSharedCharacterFromCloud('cloud-1', 'user-1')

    expect(mockBatchInsertCharacters).toHaveBeenCalledTimes(1)
    const inserted = mockBatchInsertCharacters.mock.calls[0][0][0]
    expect(inserted.voice).toBe('Umbriel')
  })
})
