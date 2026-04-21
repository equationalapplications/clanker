export interface UsageSnapshotPayload {
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
}

function isPlanStatus(value: unknown): value is 'active' | 'cancelled' | 'expired' {
  return value === 'active' || value === 'cancelled' || value === 'expired'
}

export function toUsageSnapshotPayload(value: unknown): UsageSnapshotPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as {
    remainingCredits?: unknown
    planTier?: unknown
    planStatus?: unknown
    verifiedAt?: unknown
  }

  const verifiedAt = typeof record.verifiedAt === 'string' ? record.verifiedAt.trim() : ''
  if (!verifiedAt) {
    return null
  }

  const remainingCredits =
    typeof record.remainingCredits === 'number' && Number.isFinite(record.remainingCredits)
      ? record.remainingCredits
      : null

  const planTier = typeof record.planTier === 'string' ? record.planTier : null
  const planStatus = isPlanStatus(record.planStatus) ? record.planStatus : null

  return {
    remainingCredits,
    planTier,
    planStatus,
    verifiedAt,
  }
}

export function usageSnapshotFromError(error: unknown): UsageSnapshotPayload | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const details = (error as { details?: unknown }).details
  const direct = toUsageSnapshotPayload(details)
  if (direct) {
    return direct
  }

  if (details && typeof details === 'object' && 'usageSnapshot' in details) {
    return toUsageSnapshotPayload((details as { usageSnapshot?: unknown }).usageSnapshot)
  }

  return null
}
