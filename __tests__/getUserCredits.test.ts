jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(),
  spendCreditsFn: jest.fn(),
}))

jest.mock('~/services/apiClient', () => ({
  getUserState: jest.fn(),
}))

import { getCurrentUser } from '~/config/firebaseConfig'
import { getUserState } from '~/services/apiClient'
import { getUserCredits } from '~/utilities/getUserCredits'

const mockGetCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>
const mockGetUserState = getUserState as jest.MockedFunction<typeof getUserState>

describe('getUserCredits', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns zero credits when there is no Firebase user', async () => {
    mockGetCurrentUser.mockReturnValue(null)

    const result = await getUserCredits()

    expect(result).toEqual({
      totalCredits: 0,
      hasUnlimited: false,
      subscriptions: [],
    })
  })

  it('keeps current credits when subscription is cancelled', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'firebase-1' } as any)
    mockGetUserState.mockResolvedValue({
      user: {
        id: 'u1',
        firebaseUid: 'firebase-1',
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
        currentCredits: 12,
        termsVersion: 'v1',
        termsAcceptedAt: null,
      },
    })

    const result = await getUserCredits()

    expect(result.totalCredits).toBe(12)
    expect(result.hasUnlimited).toBe(false)
    expect(result.subscriptions).toEqual([
      {
        tier: 'monthly_20',
        credits: 12,
        isUnlimited: false,
      },
    ])
  })
})