import { syncDisplayNameFromCredential } from '../syncDisplayName'

const makeUser = (overrides: any = {}) => ({
  displayName: null as string | null,
  providerData: [] as Array<{ displayName?: string | null }>,
  updateProfile: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('syncDisplayNameFromCredential', () => {
  it('skips when displayName already set', async () => {
    const user = makeUser({ displayName: 'Existing' })
    await syncDisplayNameFromCredential(user as any, 'Fallback')
    expect(user.updateProfile).not.toHaveBeenCalled()
  })

  it('uses fallbackName when provided and displayName empty', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any, 'Jane Doe')
    expect(user.updateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' })
  })

  it('falls back to providerData[0].displayName when no fallback', async () => {
    const user = makeUser({ providerData: [{ displayName: 'From Provider' }] })
    await syncDisplayNameFromCredential(user as any)
    expect(user.updateProfile).toHaveBeenCalledWith({ displayName: 'From Provider' })
  })

  it('skips when no displayName, no fallback, and no providerData name', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any)
    expect(user.updateProfile).not.toHaveBeenCalled()
  })

  it('trims whitespace and treats empty after trim as missing', async () => {
    const user = makeUser()
    await syncDisplayNameFromCredential(user as any, '   ')
    expect(user.updateProfile).not.toHaveBeenCalled()
  })
})
