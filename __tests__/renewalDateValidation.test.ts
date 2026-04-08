import { normalizeRenewalDateInput } from '~/components/admin/renewalDateValidation'

describe('normalizeRenewalDateInput', () => {
  it('returns null for empty or whitespace input', () => {
    expect(normalizeRenewalDateInput('')).toBeNull()
    expect(normalizeRenewalDateInput('   ')).toBeNull()
  })

  it('accepts UTC ISO input ending in Z', () => {
    expect(normalizeRenewalDateInput('2026-05-01T00:00:00Z')).toBe('2026-05-01T00:00:00.000Z')
    expect(normalizeRenewalDateInput('2026-05-01T00:00:00.000Z')).toBe('2026-05-01T00:00:00.000Z')
  })

  it('rejects non-UTC or non-ISO variants', () => {
    expect(normalizeRenewalDateInput('2026-05-01T00:00:00+00:00')).toBeNull()
    expect(normalizeRenewalDateInput('2026-05-01 00:00:00')).toBeNull()
    expect(normalizeRenewalDateInput('not-a-date')).toBeNull()
  })

  it('rejects impossible calendar dates even when format matches', () => {
    expect(normalizeRenewalDateInput('2026-02-30T00:00:00Z')).toBeNull()
  })
})