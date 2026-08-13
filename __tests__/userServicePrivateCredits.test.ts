jest.mock('~/services/apiClient', () => ({
  updateUserProfile: jest.fn(),
}))

jest.mock('~/auth/bootstrapSession', () => ({
  bootstrapSession: jest.fn(),
}))

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: Promise.resolve(),
  deleteMyAccountFn: jest.fn(),
}))

import { bootstrapSession } from '~/auth/bootstrapSession'
import { getUserPrivate } from '~/services/userService'

const mockBootstrapSession = bootstrapSession as jest.MockedFunction<typeof bootstrapSession>

describe('getUserPrivate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns credits when plan is active', async () => {
    mockBootstrapSession.mockResolvedValue({
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
        grantedTotal: 0,
        termsVersion: 'v1',
        termsAcceptedAt: '2026-04-20T00:00:00.000Z',
        nextExpiryDate: null,
        cancelAtPeriodEnd: false,
        subscriptionProvider: 'stripe',
      },
    })

    const result = await getUserPrivate()

    expect(result).not.toBeNull()
    expect(result?.credits).toBe(77)
  })

  it('returns hasAcceptedTermsDate as ISO string for persistence safety', async () => {
    mockBootstrapSession.mockResolvedValue({
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
        grantedTotal: 0,
        termsVersion: 'v1',
        termsAcceptedAt: '2026-04-20T00:00:00.000Z',
        nextExpiryDate: null,
        cancelAtPeriodEnd: false,
        subscriptionProvider: 'stripe',
      },
    })

    const result = await getUserPrivate()

    expect(result).not.toBeNull()
    expect(result?.hasAcceptedTermsDate).toBe('2026-04-20T00:00:00.000Z')
    expect(typeof result?.hasAcceptedTermsDate).toBe('string')
  })
})
