jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn(),
}))

jest.mock('~/auth/bootstrapSession', () => ({
  bootstrapSession: jest.fn(),
}))

import { bootstrapSession } from '~/auth/bootstrapSession'
import { getCurrentUser } from '~/config/firebaseConfig'
import { getUserCredits } from '~/utilities/getUserCredits'

const mockGetCurrentUser = getCurrentUser as jest.MockedFunction<typeof getCurrentUser>
const mockBootstrapSession = bootstrapSession as jest.MockedFunction<typeof bootstrapSession>

describe('getUserCredits', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns zero credits when there is no Firebase user', async () => {
    mockGetCurrentUser.mockReturnValue(null)

    const result = await getUserCredits()

    expect(result).toEqual({
      totalCredits: 0,
      nextExpiryDate: null,
    })
  })

  it('keeps current credits when subscription is cancelled', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'firebase-1' } as any)
    mockBootstrapSession.mockResolvedValue({
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
        grantedTotal: 0,
        termsVersion: 'v1',
        termsAcceptedAt: null,
        nextExpiryDate: null,
        cancelAtPeriodEnd: false,
        subscriptionProvider: 'stripe',
      },
    })

    const result = await getUserCredits()

    expect(result.totalCredits).toBe(12)
    expect(result.nextExpiryDate).toBe(null)
  })
})
