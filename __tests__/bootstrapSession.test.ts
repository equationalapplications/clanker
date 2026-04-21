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
})