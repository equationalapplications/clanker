const mockRunAsync = jest.fn()
const mockGetFirstAsync = jest.fn()

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(async () => ({
    withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    runAsync: mockRunAsync,
    getFirstAsync: mockGetFirstAsync,
  })),
}))

import { batchInsertCharacters, createCharacter, type LocalCharacter } from '../src/database/characterDatabase'

describe('batchInsertCharacters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFirstAsync.mockResolvedValue(null)
  })

  it('includes voice in insert columns and values', async () => {
    const character: LocalCharacter = {
      id: 'char-1',
      user_id: 'user-1',
      name: 'Char',
      avatar: null,
      avatar_data: null,
      avatar_mime_type: null,
      appearance: null,
      traits: null,
      emotions: null,
      context: null,
      is_public: 0,
      created_at: 1,
      updated_at: 2,
      synced_to_cloud: 1,
      save_to_cloud: 1,
      cloud_id: 'cloud-1',
      deleted_at: null,
      summary_checkpoint: 0,
      owner_user_id: 'user-1',
      voice: 'Kore',
    }

    await batchInsertCharacters([character])

    expect(mockRunAsync).toHaveBeenCalledTimes(1)
    const [sql, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('owner_user_id, voice')
    expect(values.at(-1)).toBe('Kore')
  })

  it('defaults createCharacter voice to Umbriel when omitted', async () => {
    await createCharacter('user-1', {
      name: 'New Character',
      is_public: false,
    })

    const [, values] = mockRunAsync.mock.calls[0] as [string, unknown[]]
    expect(values.at(-1)).toBe('Umbriel')
  })
})