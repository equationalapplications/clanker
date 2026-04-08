import { canSubmitAdminConfirmation } from '~/components/admin/confirmationValidation'

describe('canSubmitAdminConfirmation', () => {
  it('allows submit when no keyword is required and reason is present', () => {
    expect(
      canSubmitAdminConfirmation({
        typedKeyword: '',
        requireReason: true,
        reason: 'needed for support case',
        loading: false,
      }),
    ).toBe(true)
  })

  it('blocks submit when destructive keyword does not match', () => {
    expect(
      canSubmitAdminConfirmation({
        confirmKeyword: 'DELETE',
        typedKeyword: 'remove',
        requireReason: true,
        reason: 'security incident cleanup',
        loading: false,
      }),
    ).toBe(false)
  })

  it('blocks submit while loading', () => {
    expect(
      canSubmitAdminConfirmation({
        confirmKeyword: 'RESET',
        typedKeyword: 'RESET',
        requireReason: true,
        reason: 'fraud investigation',
        loading: true,
      }),
    ).toBe(false)
  })
})
