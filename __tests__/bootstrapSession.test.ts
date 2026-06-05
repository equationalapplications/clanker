const mockGetCurrentUser = jest.fn()
const mockExchangeToken = jest.fn()
const mockAppCheckReady = Promise.resolve()

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  exchangeToken: (...args: unknown[]) => mockExchangeToken(...args),
  appCheckReady: mockAppCheckReady,
}))

import { bootstrapSession } from '~/auth/bootstrapSession'

const bootstrapData = {
  user: {
    id: 'user-1',
    firebaseUid: 'firebase-1',
    email: 'test@example.com',
    displayName: null,
    avatarUrl: null,
    isProfilePublic: true,
    defaultCharacterId: null,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
  },
  subscription: {
    planTier: 'free',
    planStatus: 'active',
    currentCredits: 10,
    termsVersion: 'v1',
    termsAcceptedAt: null,
  },
}

describe('bootstrapSession', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCurrentUser.mockReturnValue({ uid: 'firebase-1' })
  })

  it('dedupes concurrent calls into a single exchangeToken request', async () => {
    mockExchangeToken.mockResolvedValue({ data: bootstrapData })

    const first = bootstrapSession()
    const second = bootstrapSession()

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(mockExchangeToken).toHaveBeenCalledTimes(1)
    expect(firstResult).toEqual(bootstrapData)
    expect(secondResult).toEqual(bootstrapData)
  })

  it('does not reuse in-flight bootstrap across different users', async () => {
    let currentUid = 'firebase-1'
    mockGetCurrentUser.mockImplementation(() => ({ uid: currentUid }))

    const secondUserData = {
      ...bootstrapData,
      user: {
        ...bootstrapData.user,
        id: 'user-2',
        firebaseUid: 'firebase-2',
      },
    }

    let resolveFirstCall!: (value: { data: typeof bootstrapData }) => void
    const firstCallPromise = new Promise<{ data: typeof bootstrapData }>((resolve) => {
      resolveFirstCall = (value) => {
        resolve(value)
      }
    })

    mockExchangeToken
      .mockImplementationOnce(() => firstCallPromise)
      .mockResolvedValueOnce({ data: secondUserData })

    const first = bootstrapSession()
    currentUid = 'firebase-2'
    const second = bootstrapSession()

    resolveFirstCall({ data: bootstrapData })

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(mockExchangeToken).toHaveBeenCalledTimes(2)
    expect(firstResult.user.firebaseUid).toBe('firebase-1')
    expect(secondResult.user.firebaseUid).toBe('firebase-2')
  })

  describe('mock auth branch (EXPO_PUBLIC_USE_MOCK_AUTH)', () => {
    const originalEnv = process.env.EXPO_PUBLIC_USE_MOCK_AUTH

    beforeEach(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_AUTH = 'true'
    })

    afterEach(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_AUTH = originalEnv
    })

    it('returns mock user and subscription without calling exchangeToken', async () => {
      const result = await bootstrapSession()

      expect(mockExchangeToken).not.toHaveBeenCalled()
      expect(result.user.id).toBe('11111111-1111-4111-8111-111111111111')
      expect(result.user.firebaseUid).toBe('local_test_user_123')
      expect(result.user.email).toBe('dev@localhost.com')
      expect(result.subscription.planTier).toBe('free')
      expect(result.subscription.currentCredits).toBe(100)
    })

    it('returns consistent mock data across multiple calls', async () => {
      const first = await bootstrapSession()
      const second = await bootstrapSession()

      expect(first.user.firebaseUid).toBe('local_test_user_123')
      expect(second.user.firebaseUid).toBe('local_test_user_123')
      expect(first.subscription.currentCredits).toBe(second.subscription.currentCredits)
    })
  })
})