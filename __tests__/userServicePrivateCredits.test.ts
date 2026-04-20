jest.mock('~/services/apiClient', () => ({
  getUserState: jest.fn(),
  updateUserProfile: jest.fn(),
}))

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: Promise.resolve(),
  deleteMyAccountFn: jest.fn(),
}))

import { getUserState } from '~/services/apiClient'
import { getUserPrivate } from '~/services/userService'

const mockGetUserState = getUserState as jest.MockedFunction<typeof getUserState>

describe('getUserPrivate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns credits when plan is active', async () => {
    mockGetUserState.mockResolvedValue({
      user: {
        id: 'u1',
        firebaseUid: 'f1',
        email: 'user@example.com',
        displayName: null,
        avatarUrl: null,
        isProfilePublic: true,
        defaultCharacterId: null,
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-20T00:00:00.000Z',
      },
      subscription: {
        planTier: 'monthly_20',
        planStatus: 'active',
        currentCredits: 77,
        termsVersion: 'v1',
        termsAcceptedAt: '2026-04-20T00:00:00.000Z',
      },
    })

    const result = await getUserPrivate()

    expect(result).not.toBeNull()
    expect(result?.credits).toBe(77)
  })

  it('returns current credits when plan is not active', async () => {
    mockGetUserState.mockResolvedValue({
      user: {
        id: 'u1',
        firebaseUid: 'f1',
        email: 'user@example.com',
        displayName: null,
        avatarUrl: null,
        isProfilePublic: true,
        defaultCharacterId: null,
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-20T00:00:00.000Z',
      },
      subscription: {
        planTier: 'monthly_20',
        planStatus: 'cancelled',
        currentCredits: 77,
        termsVersion: 'v1',
        termsAcceptedAt: '2026-04-20T00:00:00.000Z',
      },
    })

    const result = await getUserPrivate()

    expect(result).not.toBeNull()
    expect(result?.credits).toBe(77)
  })
})
