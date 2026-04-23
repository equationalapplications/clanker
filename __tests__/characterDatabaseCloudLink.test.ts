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
    const beforeCall = Date.now()
    await clearCharacterCloudLink('char-1', 'user-1')
    const afterCall = Date.now()

    expect(mockRunAsync).toHaveBeenCalledWith(
      'UPDATE characters SET cloud_id = NULL, synced_to_cloud = 0, save_to_cloud = 0, is_public = 0, updated_at = ? WHERE id = ? AND user_id = ?',
      [expect.any(Number), 'char-1', 'user-1'],
    )
    const updatedAt = (mockRunAsync.mock.calls[0][1] as unknown[])[0] as number
    expect(updatedAt).toBeGreaterThanOrEqual(beforeCall)
    expect(updatedAt).toBeLessThanOrEqual(afterCall)
  })
})