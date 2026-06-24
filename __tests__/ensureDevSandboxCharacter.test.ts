jest.mock('~/database/index', () => ({
  getDatabase: jest.fn(),
}))

jest.mock('~/database/characterDatabase', () => ({
  getCharacter: jest.fn(),
}))

import { getDatabase } from '~/database/index'
import { getCharacter } from '~/database/characterDatabase'
import {
  DEV_CLOUD_CHARACTER_ID,
  DEV_CHARACTER_NAME,
  DEV_CHARACTER_TRAITS,
  DEV_FIREBASE_UID,
} from '../shared/dev-sandbox'
import { ensureDevSandboxCharacter, isDevSandboxEnabled } from '~/auth/ensureDevSandboxCharacter'

const mockGetDatabase = getDatabase as jest.Mock
const mockGetCharacter = getCharacter as jest.Mock

describe('ensureDevSandboxCharacter', () => {
  const originalEnv = process.env.EXPO_PUBLIC_USE_MOCK_AUTH

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'true'
    ;(global as { __DEV__?: boolean }).__DEV__ = true
  })

  afterEach(() => {
    process.env.EXPO_PUBLIC_USE_MOCK_AUTH = originalEnv
  })

  it('returns null when mock auth is disabled', async () => {
    process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'false'

    await expect(ensureDevSandboxCharacter(DEV_FIREBASE_UID)).resolves.toBeNull()
    expect(mockGetDatabase).not.toHaveBeenCalled()
  })

  it('creates a cloud-linked dev character when none exists', async () => {
    const runAsync = jest.fn().mockResolvedValue(undefined)
    const getFirstAsync = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    mockGetDatabase.mockResolvedValue({ getFirstAsync, runAsync })
    mockGetCharacter.mockResolvedValue({
      id: DEV_CLOUD_CHARACTER_ID,
      cloud_id: DEV_CLOUD_CHARACTER_ID,
      save_to_cloud: true,
    })

    await expect(ensureDevSandboxCharacter(DEV_FIREBASE_UID)).resolves.toBe(
      DEV_CLOUD_CHARACTER_ID,
    )

    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO characters'),
      expect.arrayContaining([
        DEV_CLOUD_CHARACTER_ID,
        DEV_FIREBASE_UID,
        DEV_CHARACTER_NAME,
        DEV_CHARACTER_TRAITS,
        DEV_CLOUD_CHARACTER_ID,
      ]),
    )
  })

  it('updates an existing linked character instead of inserting', async () => {
    const runAsync = jest.fn().mockResolvedValue(undefined)
    const getFirstAsync = jest.fn().mockResolvedValueOnce({ id: DEV_CLOUD_CHARACTER_ID })

    mockGetDatabase.mockResolvedValue({ getFirstAsync, runAsync })

    await expect(ensureDevSandboxCharacter(DEV_FIREBASE_UID)).resolves.toBe(
      DEV_CLOUD_CHARACTER_ID,
    )

    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('SET save_to_cloud = 1'),
      expect.arrayContaining([DEV_CLOUD_CHARACTER_ID, DEV_FIREBASE_UID]),
    )
    expect(runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO characters'),
      expect.anything(),
    )
  })

  it('links an existing local-only character instead of creating a duplicate', async () => {
    const runAsync = jest.fn().mockResolvedValue(undefined)
    const getFirstAsync = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'char_existing_1' })

    mockGetDatabase.mockResolvedValue({ getFirstAsync, runAsync })

    await expect(ensureDevSandboxCharacter(DEV_FIREBASE_UID)).resolves.toBe('char_existing_1')

    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('SET cloud_id = ?'),
      expect.arrayContaining([DEV_CLOUD_CHARACTER_ID, 'char_existing_1', DEV_FIREBASE_UID]),
    )
    expect(runAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO characters'),
      expect.anything(),
    )
  })

  it('isDevSandboxEnabled reflects mock auth env', () => {
    process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'true'
    expect(isDevSandboxEnabled()).toBe(true)

    process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'false'
    expect(isDevSandboxEnabled()).toBe(false)
  })
})
