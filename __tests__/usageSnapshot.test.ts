import { toUsageSnapshotPayload, usageSnapshotFromError } from '~/services/usageSnapshot'

describe('usageSnapshot', () => {
  it('rejects whitespace-only verifiedAt in direct payloads', () => {
    expect(
      toUsageSnapshotPayload({
        remainingCredits: 4,
        planTier: 'payg',
        planStatus: 'active',
        verifiedAt: '   ',
      }),
    ).toBeNull()
  })

  it('trims verifiedAt in accepted payloads', () => {
    expect(
      toUsageSnapshotPayload({
        remainingCredits: 4,
        planTier: 'payg',
        planStatus: 'active',
        verifiedAt: ' 2026-01-01T00:00:00.000Z ',
      }),
    ).toEqual({
      remainingCredits: 4,
      planTier: 'payg',
      planStatus: 'active',
      verifiedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('rejects nested usage snapshots with whitespace-only verifiedAt', () => {
    expect(
      usageSnapshotFromError({
        details: {
          usageSnapshot: {
            remainingCredits: 4,
            planTier: 'payg',
            planStatus: 'active',
            verifiedAt: '   ',
          },
        },
      }),
    ).toBeNull()
  })
})
