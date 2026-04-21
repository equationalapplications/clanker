jest.mock('~/services/apiClient', () => ({
  getUserState: jest.fn(),
  updateUserProfile: jest.fn(),
}))

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: Promise.resolve(),
  deleteMyAccountFn: jest.fn(),
}))

import { getUserState, updateUserProfile } from '~/services/apiClient'
import { getUserProfile, upsertUserProfile } from '~/services/userService'

const mockGetUserState = getUserState as jest.MockedFunction<typeof getUserState>
const mockUpdateUserProfile = updateUserProfile as jest.MockedFunction<typeof updateUserProfile>

describe('userService profile timestamp mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps bootstrap user updatedAt to profile updated_at', async () => {
    const createdAt = '2026-04-20T10:00:00.000Z'
    const updatedAt = '2026-04-20T11:00:00.000Z'

    mockGetUserState.mockResolvedValue({
      user: {
        id: 'u1',
        firebaseUid: 'f1',
        email: 'user@example.com',
        displayName: 'Test',
        avatarUrl: null,
        isProfilePublic: true,
        defaultCharacterId: null,
        createdAt,
        updatedAt,
      },
      subscription: {
        planTier: 'free',
        planStatus: 'active',
        currentCredits: 50,
        termsVersion: null,
        termsAcceptedAt: null,
      },
    })

    const profile = await getUserProfile()

    expect(profile).toMatchObject({
      user_id: 'u1',
      created_at: createdAt,
      updated_at: updatedAt,
    })
  })

  it('maps updateUserProfile response updatedAt to updated_at', async () => {
    const createdAt = '2026-04-20T10:00:00.000Z'
    const updatedAt = '2026-04-20T12:30:00.000Z'

    mockUpdateUserProfile.mockResolvedValue({
      data: {
        id: 'u1',
        firebaseUid: 'f1',
        email: 'user@example.com',
        displayName: 'Renamed',
        avatarUrl: null,
        isProfilePublic: false,
        defaultCharacterId: null,
        createdAt,
        updatedAt,
      },
    })

    const profile = await upsertUserProfile({ display_name: 'Renamed' })

    expect(profile).toMatchObject({
      user_id: 'u1',
      created_at: createdAt,
      updated_at: updatedAt,
    })
  })
})
