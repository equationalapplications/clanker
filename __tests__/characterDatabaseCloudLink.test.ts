const mockRunAsync = jest.fn()

jest.mock('../src/database/index', () => ({
  getDatabase: jest.fn(async () => ({
    runAsync: mockRunAsync,
  })),
}))

import { clearCharacterCloudLink } from '../src/database/characterDatabase'

describe('clearCharacterCloudLink', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('disables future cloud sync when clearing cloud link', async () => {
    await clearCharacterCloudLink('char-1', 'user-1')

    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE characters SET cloud_id = NULL, synced_to_cloud = 0, save_to_cloud = 0 WHERE id = ? AND user_id = ?',
      ['char-1', 'user-1'],
    )
  })
})