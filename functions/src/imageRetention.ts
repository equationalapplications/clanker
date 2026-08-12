import { onSchedule, type ScheduledEvent } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'
import { characterImageService } from './services/characterImageService.js'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'

/**
 * Spec §3.2: cloud `character_images` rows are retained for 30 days after
 * deletion so other devices can reconcile a deletion they were offline for
 * (§13.3), then dropped by a retention pass. The Storage objects behind a
 * tombstoned row are deleted immediately at tombstone time — only the row
 * lingers, and rows are tens of bytes — so this sweep is table hygiene, not
 * a correctness requirement.
 */
export const RETENTION_DAYS = 30

export const imageRetentionSweepHandler = async (
  deps: { characterImageService: Pick<typeof characterImageService, 'sweepExpiredTombstones'> } = {
    characterImageService,
  },
): Promise<void> => {
  const deletedCount = await deps.characterImageService.sweepExpiredTombstones(RETENTION_DAYS)
  logger.info('Image tombstone retention sweep complete', { deletedCount })
}

export const imageRetentionSweep = onSchedule(
  {
    schedule: 'every 24 hours',
    region: 'us-central1',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  async (event: ScheduledEvent) => {
    void event
    await imageRetentionSweepHandler()
  },
)
