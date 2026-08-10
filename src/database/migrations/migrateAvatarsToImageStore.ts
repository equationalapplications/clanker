/**
 * One-shot data move from `characters.avatar_data` into `character_images`.
 *
 * Runs in JS rather than as SQL because it needs three pieces of conditional
 * logic SQL cannot express cleanly: recognising the bundled default so it can
 * be purged, sniffing the true image format of bytes whose recorded mime type
 * is unreliable, and re-encoding the rows that turn out to be mislabelled.
 *
 * `avatar_data` is deliberately left in place and unread for one release as a
 * rollback net; a follow-up drops the column.
 */

import { getDatabase } from '~/database/index'
import { Storage } from '~/utilities/kvStorage'
import {
  getCharacterImages,
  getInlineImagesMissingThumbForUser,
  insertCharacterImage,
  setActiveImageId,
  updateImageRefs,
  type CharacterImageRow,
} from '~/database/characterImageDatabase'
import { prepareImageVariants } from '~/services/imageVariants'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
import { promoteCharacterImagesToCloud } from '~/services/characterImageSyncService'

const AVATAR_MIGRATION_FLAG_PREFIX = 'avatar-image-store-migration'

/**
 * Completion flag key, namespaced per user.
 *
 * The migration query is already per-user, so a device-wide key would let the
 * first account to finish suppress migration for every other account that signs
 * in on the same device — their `avatar_data` would never move. The flag also
 * survives sign-out (kvStorage is not cleared), so this is reachable in normal
 * use, not just on shared devices.
 */
export function avatarMigrationFlagKey(userId: string): string {
  return `${AVATAR_MIGRATION_FLAG_PREFIX}:${userId}`
}

interface LegacyAvatarRow {
  id: string
  user_id: string
  avatar_data: string | null
  avatar_mime_type: string | null
  save_to_cloud: number
}

/**
 * Identify the real format from the base64 payload.
 *
 * `saveCharacterImageLocally` and `useAvatarUpload` both hardcoded 'image/webp',
 * but on web `SaveFormat.WEBP` silently produced PNG on browsers without WebP
 * canvas encoding — so some stored rows are PNG bytes labelled WebP.
 */
export function sniffImageMimeType(base64: string): string {
  if (base64.startsWith('UklGR')) return 'image/webp'   // RIFF
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  return 'image/webp'
}

/**
 * Strict byte equality against the shipped default, with a length pre-check so
 * the common case stays cheap.
 *
 * Safe because the constant never changed: only two commits ever touched
 * `src/utilities/defaultAvatarBase64.ts`, both inside PR #395, so no release
 * shipped different default bytes — and `characterMachine` wrote the constant
 * verbatim rather than re-encoding it, making stored copies byte-identical.
 */
function isBundledDefault(avatarData: string, defaultBase64: string): boolean {
  return avatarData.length === defaultBase64.length && avatarData === defaultBase64
}

export async function migrateAvatarsToImageStore(
  userId: string,
  defaultAvatarBase64: string,
): Promise<void> {
  const flagKey = avatarMigrationFlagKey(userId)
  const alreadyRun = await Storage.getItem(flagKey)
  if (alreadyRun) return

  const db = await getDatabase()
  const rows = await db.getAllAsync<LegacyAvatarRow>(
    'SELECT id, user_id, avatar_data, avatar_mime_type, save_to_cloud FROM characters WHERE user_id = ? AND avatar_data IS NOT NULL',
    [userId],
  )

  let allSucceeded = true

  for (const row of rows) {
    try {
      const avatarData = row.avatar_data
      if (!avatarData) continue

      // Purge the duplicated default: these characters fall through to the
      // bundled asset instead of carrying their own 7.6 KB copy.
      if (isBundledDefault(avatarData, defaultAvatarBase64)) continue

      // Idempotency: a character that already has gallery rows was migrated on
      // an earlier, interrupted run.
      const existing = await getCharacterImages(row.id)
      if (existing.length > 0) continue

      const imageId = generateSecureUuid()
      const imageRow: CharacterImageRow = {
        id: imageId,
        character_id: row.id,
        user_id: row.user_id,
        storage_kind: 'inline',
        master_ref: avatarData,
        // No thumb yet — the background pass derives one. The resolver falls
        // back to the master until then.
        thumb_ref: null,
        mime_type: sniffImageMimeType(avatarData),
        source: 'uploaded',
        sync_state: 'local',
        sync_attempts: 0,
        created_at: Date.now(),
        deleted_at: null,
        message_id: null,
      }

      await insertCharacterImage(imageRow)
      await setActiveImageId(row.id, imageId)
    } catch (err) {
      console.warn('[avatarMigration] character failed, will retry next launch:', row.id, err)
      allSucceeded = false
    }
  }

  // Step 3: derive thumbs and fix mislabelled masters, then promote
  // save_to_cloud characters' rows so the sweeper picks them up.
  //
  // Driven by fresh queries, not by what THIS pass inserted: a run interrupted
  // between the loop above and here is retried later, but the per-character
  // idempotency check makes every one of those characters skip the insert on
  // retry (they already have gallery rows) — an in-memory list scoped to this
  // pass would then never backfill their thumbnail or promote them to cloud,
  // silently for the rest of the app's life. Failures here are per-row/
  // per-character and logged rather than clearing `allSucceeded` — the row is
  // already a valid `inline` row that resolves via the master fallback, so it
  // is not worth re-running the whole migration over a missing thumbnail.
  const pendingThumbnails = await getInlineImagesMissingThumbForUser(userId)
  if (pendingThumbnails.length > 0) {
    await backfillThumbnails(pendingThumbnails)
  }
  for (const row of rows) {
    if (!row.save_to_cloud) continue
    try {
      await promoteCharacterImagesToCloud(row.id)
    } catch (err) {
      console.warn('[avatarMigration] cloud promotion failed for', row.id, err)
    }
  }

  // Only claim completion on a clean pass — a partial run must retry.
  if (allSucceeded) {
    await Storage.setItem(flagKey, 'done')
  }
}

/**
 * Background pass: derive missing thumbnails and fix mislabelled masters.
 *
 * Correcting `mime_type` is necessary but not sufficient — storage.rules admits
 * only image/webp and image/jpeg, so even a correctly-labelled PNG is rejected
 * at upload. PNG masters are therefore re-encoded, not relabelled; the pass is
 * already invoking the manipulator for the thumb, so it costs one extra output.
 * Rows that stay inline keep their bytes when the format is already acceptable —
 * re-encoding those would cost quality for no gain.
 */
export async function backfillThumbnails(rows: CharacterImageRow[]): Promise<void> {
  for (const row of rows) {
    if (row.thumb_ref) continue
    // Only `inline` rows carry base64 in their refs. Writing a base64 thumb onto
    // a 'file' or 'cloud' row while leaving storage_kind alone would hand the
    // resolver a blob where it expects a path/URI. The migration only ever
    // produces inline rows, so this is a guard against future callers.
    if (row.storage_kind !== 'inline') continue

    try {
      const needsReencode = row.mime_type === 'image/png'
      const sourceUri = `data:${row.mime_type};base64,${row.master_ref}`

      const variants = await prepareImageVariants({ uri: sourceUri, width: 1024, height: 1024 })

      await updateImageRefs(row.id, {
        storage_kind: row.storage_kind,
        master_ref: needsReencode ? variants.master.base64 : row.master_ref,
        thumb_ref: variants.thumb.base64,
        mime_type: needsReencode ? variants.master.mimeType : row.mime_type,
        sync_state: row.sync_state,
      })
    } catch (err) {
      console.warn('[avatarMigration] thumbnail backfill failed for', row.id, err)
    }
  }
}