import { updateProfile } from '@react-native-firebase/auth'
import { syncDisplayNameFromCredential } from '../syncDisplayName'

jest.mock('@react-native-firebase/auth', () => ({
  updateProfile: jest.fn().mockResolvedValue(undefined),
}))

const makeUser = (overrides: any = {}) => ({
  displayName: null as string | null,
  providerData: [] as { displayName?: string | null }[],
  ...overrides,
})

describe('syncDisplayNameFromCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('skips when displayName already set', async () => {
    const user = makeUser({ displayName: 'Existing' })
    await syncDisplayNameFromCredential(user as any, 'Fallback')
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('uses fallbackName when provided and displayName empty', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any, 'Jane Doe')
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: 'Jane Doe' })
  })

  it('falls back to providerData[0].displayName when no fallback', async () => {
    const user = makeUser({ providerData: [{ displayName: 'From Provider' }] })
    await syncDisplayNameFromCredential(user as any)
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: 'From Provider' })
  })

  it('skips when no displayName, no fallback, and no providerData name', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any)
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it('trims whitespace and treats empty after trim as missing', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any, '   ')
    expect(updateProfile).not.toHaveBeenCalled()
  })
})
