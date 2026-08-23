/**
 * Character sync service - backup/restore characters between local SQLite and Firebase Cloud Functions
 *
 * Strategy:
 * - Local SQLite is the source of truth
 * - Cloud is a backup; sync is unidirectional (local → cloud) for normal use
 * - restoreFromCloud() imports all cloud characters into local (for new device setup)
 * - Conflict resolution: last-write-wins by updated_at timestamp
 * - Messages are NEVER synced to cloud (privacy)
 * - Deletions are soft-deleted locally first, then propagated to cloud on next sync
 */

import { Storage } from '~/utilities/kvStorage'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
import { normalizeVoice } from '~/constants/voiceDefaults'
import { getCurrentUser } from '~/config/firebaseConfig'
import { isDevSandboxEnabled } from '~/auth/devSandboxFlag'
import { reportError } from '~/utilities/reportError'
import {
  syncCharacterFn,
  deleteCharacterFn,
  getUserCharactersFn,
  getPublicCharacterFn,
  wikiSync,
} from './apiClient'
import { deleteAllImagesForCharacter, saveCharacterImage } from './characterImageService'
import {
  demoteCharacterImagesToLocal,
  reconcileCharacterImages,
  syncCharacterImages,
} from './characterImageSyncService'
import {
  getAllImagesForCharacter,
  hardDeleteCharacterImage,
} from '~/database/characterImageDatabase'
import type { CharacterSnapshot, WikiSyncBundle } from './apiClient'
import {
  getUnsyncedCharacters,
  getSoftDeletedCharacters,
  getAllCharactersIncludingDeleted,
  markCharacterSynced,
  hardDeleteCharacterLocal,
  batchInsertCharacters,
  clearCharacterCloudLink,
  setPendingCloudIdIfMissing,
  getCharacter,
  LocalCharacter,
} from '../database/characterDatabase'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { schemaOrgWarmAgentManifest } from '@equationalapplications/schema-org-llm-wiki'
import { getWiki } from '~/services/wikiService'
import { wikiOrchestrator } from '~/services/wikiOrchestrator'
import {
  mapFactSourceTypesForCloudSync,
  mapFactSourceTypesFromCloud,
} from '~/services/wikiSourceType'

const LAST_SYNC_KEY = 'character-last-sync'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// The owner's active master is always produced by this same pipeline (§6 step
// 2: resized to 1024 on the longest edge, never upscaled), so it is square or
// smaller in practice. A legacy migrated avatar can be non-square, in which
// case this over-states one edge and `resizeActions` in imageVariants.ts
// skips a resize that a real probe would have performed — CharacterAvatar's
// `resizeMode: 'cover'` (§16) absorbs the resulting aspect mismatch on
// display, so this is a quality nit, not a correctness bug.
const IMPORTED_AVATAR_DIMENSION = 1024

function reportWikiOpForCharacter(
  err: unknown,
  context: string,
  characterId: string,
  summary: string,
): void {
  const detail = `${summary} (character ${characterId})`
  if (err instanceof Error) {
    // Augment message for Crashlytics searchability; keep original stack/cause so
    // diagnostics still point at the failing call site (reportError forwards the Error as-is).
    const augmented = new Error(`${detail}: ${err.message}`, { cause: err })
    augmented.stack = err.stack
    reportError(augmented, context)
    return
  }
  reportError(new Error(`${detail}: ${String(err)}`), context)
}

function generateLocalCharacterId() {
  return `char_${generateSecureUuid()}`
}

// Carry over the three legacy portrait columns from the local row, never
// read from the cloud snapshot:
// - `avatar` stopped shipping with the cloud snapshot when migration 0025
//   dropped characters.avatar. batchInsertCharacters is INSERT OR REPLACE,
//   so hardcoding null here would wipe the rollback copy of any character
//   the one-shot migration has not converted yet (a partial migration
//   retries on the next launch, and this restore can run in between). On a
//   genuinely new device there is no local row and this is null anyway.
// - `avatar_data` and `avatar_mime_type` live in `character_images` now
//   (see reconcileCharacterImages), so these legacy columns are inert but
//   still carried over from the local row for the same reason.
function legacyPortraitCarryOver(existingLocal: LocalCharacter | undefined): {
  avatar: string | null
  avatar_data: string | null
  avatar_mime_type: string | null
} {
  return {
    avatar: existingLocal?.avatar ?? null,
    avatar_data: existingLocal?.avatar_data ?? null,
    avatar_mime_type: existingLocal?.avatar_mime_type ?? null,
  }
}

export async function getLastSyncTime(): Promise<string | null> {
  return Storage.getItem(LAST_SYNC_KEY)
}

async function setLastSyncTime(): Promise<void> {
  try {
    await Storage.setItem(LAST_SYNC_KEY, new Date().toISOString())
  } catch (error) {
    console.warn('Failed to persist last sync time:', error)
  }
}

type SyncWikiForCloudOptions = {
  /**
   * Tag for `reportError` when `wikiOrchestrator.syncAll` fails at the pipeline level
   * (distinct from periodic background sync vs restore-from-cloud).
   */
  pipelineErrorReportTag?: string
}

/**
 * Export local wiki memory for cloud characters and sync to cloud.
 */
async function syncWikiForCloud(
  localUserId: string,
  options?: SyncWikiForCloudOptions,
): Promise<void> {
  const localChars = await getAllCharactersIncludingDeleted(localUserId)
  const cloudChars = localChars.filter(
    (c) => c.save_to_cloud && c.cloud_id && UUID_REGEX.test(c.cloud_id) && !c.deleted_at,
  )
  if (cloudChars.length === 0) return

  const wiki = getWiki()
  if (!wiki) {
    // Expected before wiki singleton initializes or when wiki is inactive — not an error report.
    console.warn('[syncWikiForCloud] wiki unavailable — skipping wiki sync for all characters')
    return
  }

  const items = cloudChars.map((char) => {
    const cloudId = char.cloud_id!
    return {
      entityId: char.id,
      runRemoteSync: async (localDump: MemoryDump): Promise<MemoryDump> => {
        const localBundle = localDump.entities[char.id] ?? {
          facts: [],
          tasks: [],
          events: [],
          edges: [],
        }

        let ontology: WikiSyncBundle['ontology']
        try {
          const existing = await wiki.getOntologyManifest(char.id)
          if (existing) ontology = existing
        } catch (err) {
          reportWikiOpForCharacter(
            err,
            `wiki:${char.id}:ontology:read`,
            char.id,
            'Failed to read ontology manifest',
          )
        }

        const cloudDump = {
          generatedAt: localDump.generatedAt,
          entities: {
            [cloudId]: {
              facts: mapFactSourceTypesForCloudSync(
                localBundle.facts.map((f) => ({ ...f, entity_id: cloudId })),
              ),
              tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudId })),
              events: localBundle.events.map((e) => ({ ...e, entity_id: cloudId })),
              edges: localBundle.edges?.map((e) => ({ ...e, entity_id: cloudId })) ?? [],
              ontology,
            } satisfies WikiSyncBundle,
          },
        }
        const result = await wikiSync({ dump: cloudDump })
        const remoteDump = result.data?.remoteDump
        if (!remoteDump) {
          throw new Error('wikiSync returned without remoteDump in response data')
        }
        const cloudBundle = remoteDump.entities[cloudId] ?? {
          facts: [],
          tasks: [],
          events: [],
          edges: [],
        }

        if (cloudBundle.ontology) {
          try {
            await wiki.setOntologyManifest(
              char.id,
              cloudBundle.ontology.manifest ?? { node_types: [], edge_types: [] },
              { mode: cloudBundle.ontology.mode },
            )
          } catch (err) {
            reportWikiOpForCharacter(
              err,
              `wiki:${char.id}:ontology:write`,
              char.id,
              'Failed to write ontology manifest',
            )
          }
        }

        return {
          generatedAt: remoteDump.generatedAt,
          entities: {
            [char.id]: {
              facts: mapFactSourceTypesFromCloud(cloudBundle.facts),
              tasks: cloudBundle.tasks,
              events: cloudBundle.events,
              edges: cloudBundle.edges?.map((e) => ({ ...e, entity_id: char.id })) ?? [],
            },
          },
        }
      },
    }
  })

  const pipelineTag = options?.pipelineErrorReportTag ?? 'wiki:sync:batch'

  try {
    await wikiOrchestrator.syncAll(items, wiki, 2)
  } catch (pipelineErr) {
    if (pipelineErr instanceof WikiBusyError) {
      return
    }
    // Orchestrator-level error (e.g., timeout, internal failure).
    // Per-entity failures are surfaced via the wiki machine / actor error path.
    reportError(pipelineErr, pipelineTag)
    return
  }

  // Best-effort: type facts that bypassed the librarian (cloud-agent writes,
  // pre-ontology facts). One batch per sync; backlog converges across syncs.
  for (const char of cloudChars) {
    // Seed the curated schema.org ontology for characters that have none.
    // Runs after syncAll so a manifest restored from cloud wins over the seed;
    // the seeded manifest propagates to cloud on the next sync. On failure the
    // character stays in mode 'off' and the next sync retries.
    try {
      const existing = await wiki.getOntologyManifest(char.id)
      if (!existing) {
        await wiki.setOntologyManifest(char.id, schemaOrgWarmAgentManifest, { mode: 'strict' })
      }
    } catch (err) {
      if (err instanceof WikiBusyError) continue
      reportWikiOpForCharacter(
        err,
        `wiki:${char.id}:ontology:seed`,
        char.id,
        'Failed to seed ontology manifest',
      )
    }

    try {
      const result = await wiki.runOntologyBackfill(char.id)
      if (__DEV__) console.log(`[ontology:backfill] ${char.id}`, result)
      // Stalled = batch made zero progress, whether all facts deferred or all
      // failed validation; the counters in the message disambiguate which.
      if (result.scanned > 0 && result.typed === 0) {
        reportWikiOpForCharacter(
          new Error(`Backfill batch classified nothing: ${JSON.stringify(result)}`),
          `wiki:${char.id}:ontology:backfill:stalled`,
          char.id,
          'Ontology backfill stalled',
        )
      }
    } catch (err) {
      if (err instanceof WikiBusyError) continue
      reportWikiOpForCharacter(
        err,
        `wiki:${char.id}:ontology:backfill`,
        char.id,
        'Ontology backfill failed',
      )
    }
  }
}

/**
 * Sync all pending local changes to cloud.
 * Safe to call at any time — returns early if user is not authenticated.
 */
export async function syncAllToCloud(userId?: string): Promise<void> {
  if (isDevSandboxEnabled()) {
    // Mock auth has no Firebase ID token; cloud backup/sync callables would fail and
    // surface as dev LogBox errors a few seconds after startup or reconnect.
    return
  }

  const localUserId = userId || getCurrentUser()?.uid
  if (!localUserId) return

  try {
    await Promise.all([syncUnsyncedToCloud(localUserId), syncDeletionsToCloud(localUserId)])
    // Sequential, NOT inside the Promise.all above: a character has no cloud
    // id until its first successful sync, and the image storage path is built
    // from that id. Racing them would leave every first-sync image pending.
    await syncCharacterImages(localUserId)
    await syncWikiForCloud(localUserId)
    await setLastSyncTime()
  } catch (error) {
    reportError(error, 'characterSync')
    throw error
  }
}

/**
 * Restore all characters from cloud into local storage (for new device setup or data recovery).
 * Uses last-write-wins: cloud records overwrite local only if cloud updated_at is newer.
 */
export async function restoreFromCloud(userId?: string): Promise<void> {
  if (isDevSandboxEnabled()) {
    return
  }

  const localUserId = userId || getCurrentUser()?.uid
  if (!localUserId) return

  try {
    const result = await getUserCharactersFn()
    const data = result.data?.characters

    if (!data || data.length === 0) return

    // Build maps from local characters
    const localChars = await getAllCharactersIncludingDeleted(localUserId)
    const localTimestamps = new Map<string, number>()
    const cloudIdToLocalId = new Map<string, string>()
    for (const c of localChars) {
      localTimestamps.set(c.id, c.updated_at)
      if (c.cloud_id) {
        cloudIdToLocalId.set(c.cloud_id, c.id)
        if (c.cloud_id !== c.id) {
          localTimestamps.set(c.cloud_id, c.updated_at)
        }
      }
    }

    const localById = new Map(localChars.map((c) => [c.id, c]))

    const cloudChars: LocalCharacter[] = data
      .map((cloudChar: CharacterSnapshot) => {
        const localId = cloudIdToLocalId.get(cloudChar.id) ?? cloudChar.id
        const existingLocal = localById.get(localId)
        return {
          id: localId,
          user_id: localUserId,
          name: cloudChar.name,
          ...legacyPortraitCarryOver(existingLocal),
          appearance: cloudChar.appearance,
          traits: cloudChar.traits,
          emotions: cloudChar.emotions,
          context: cloudChar.context,
          is_public: cloudChar.isPublic ? 1 : 0,
          created_at: new Date(cloudChar.createdAt).getTime(),
          updated_at: new Date(cloudChar.updatedAt).getTime(),
          synced_to_cloud: 1 as number,
          save_to_cloud: 1 as number,
          cloud_id: cloudChar.id,
          pending_cloud_id: cloudChar.id,
          deleted_at: null as number | null,
          summary_checkpoint: 0,
          owner_user_id: localUserId,
          voice: normalizeVoice(cloudChar.voice),
        }
      })
      .filter((c: LocalCharacter) => {
        const localTs = localTimestamps.get(c.id)
        return localTs === undefined || c.updated_at > localTs
      })

    if (cloudChars.length > 0) {
      await batchInsertCharacters(cloudChars)
    }

    // Reconcile every returned character's image set from its cloud snapshot,
    // regardless of whether the character row itself was newer. Image adds/
    // deletes on another device do not bump the character's updated_at (the
    // syncCharacterImages handler never touches it), so gating this on
    // cloudChars would silently skip reconciliation for image-only changes —
    // the same "images vanish on restore" failure this task exists to fix,
    // just relocated to this condition. Keyed on the same cloudIdToLocalId
    // mapping used to build cloudChars, so images land on the correct local row.
    for (const cloudChar of data as CharacterSnapshot[]) {
      const localId = cloudIdToLocalId.get(cloudChar.id) ?? cloudChar.id
      try {
        await reconcileCharacterImages(
          localId,
          localUserId,
          cloudChar.images ?? [],
          cloudChar.activeImageId ?? null,
        )
      } catch (error) {
        reportError(error, 'restoreFromCloud:images')
      }
    }

    if (cloudChars.length > 0) {
      // After insert, pull wiki memory for cloud-linked characters on this device.
      // syncWikiForCloud re-queries the DB so it picks up the newly inserted rows.
      const cloudLinked = cloudChars.filter(
        (c) => c.save_to_cloud && c.cloud_id && UUID_REGEX.test(c.cloud_id) && !c.deleted_at,
      )
      if (cloudLinked.length > 0) {
        try {
          await syncWikiForCloud(localUserId, {
            pipelineErrorReportTag: 'wiki:sync:restore',
          })
        } catch (error) {
          reportError(error, 'wiki:sync:restore')
        }
      }
    }
  } catch (error) {
    reportError(error, 'restoreFromCloud')
    throw error
  }
}

async function syncUnsyncedToCloud(localUserId: string): Promise<void> {
  const unsynced = await getUnsyncedCharacters(localUserId)
  if (unsynced.length === 0) return

  for (const char of unsynced) {
    // Confirmed cloud_id (from a prior successful sync) takes priority; otherwise fall
    // back to the stable pending_cloud_id so every upload attempt — including retries
    // after a dropped response — upserts the same remote row instead of inserting a
    // new one each time. Legacy local rows created before pending_cloud_id existed
    // get one generated and persisted here, on first sync attempt.
    const confirmedCloudId = char.cloud_id && UUID_REGEX.test(char.cloud_id) ? char.cloud_id : null
    let pendingCloudId =
      char.pending_cloud_id && UUID_REGEX.test(char.pending_cloud_id) ? char.pending_cloud_id : null
    if (!confirmedCloudId && !pendingCloudId) {
      pendingCloudId = generateSecureUuid()
      await setPendingCloudIdIfMissing(char.id, pendingCloudId)
    }
    const cloudId = confirmedCloudId ?? pendingCloudId

    try {
      const result = await syncCharacterFn({
        character: {
          ...(cloudId ? { id: cloudId } : {}),
          name: char.name,
          appearance: char.appearance,
          traits: char.traits,
          emotions: char.emotions,
          context: char.context,
          voice: char.voice,
          isPublic: Boolean(char.is_public),
          createdAt: new Date(char.created_at).toISOString(),
          updatedAt: new Date(char.updated_at).toISOString(),
        },
      })

      const data = result.data

      if (data?.id) {
        await markCharacterSynced(char.id, data.id)
      }
    } catch (error: any) {
      reportWikiOpForCharacter(error, 'characterSync:upload', char.id, 'Character cloud sync')
    }
  }
}

export async function importSharedCharacterFromCloud(
  cloudCharacterId: string,
  userId?: string,
): Promise<{ localCharacterId: string; cloudCharacterId: string }> {
  const localUserId = userId || getCurrentUser()?.uid
  if (!localUserId) {
    throw new Error('User not authenticated')
  }

  const result = await getPublicCharacterFn({ characterId: cloudCharacterId })
  const cloudCharacter = result.data
  if (!cloudCharacter) {
    throw new Error('Shared character not found')
  }

  const localChars = await getAllCharactersIncludingDeleted(localUserId)
  const existingLocal = localChars.find((char) => char.cloud_id === cloudCharacter.id)
  const localCharacterId = existingLocal?.id || generateLocalCharacterId()

  await batchInsertCharacters([
    {
      id: localCharacterId,
      user_id: localUserId,
      name: cloudCharacter.name,
      ...legacyPortraitCarryOver(existingLocal),
      appearance: cloudCharacter.appearance,
      traits: cloudCharacter.traits,
      emotions: cloudCharacter.emotions,
      context: cloudCharacter.context,
      is_public: cloudCharacter.isPublic ? 1 : 0,
      created_at: new Date(cloudCharacter.createdAt).getTime(),
      updated_at: new Date(cloudCharacter.updatedAt).getTime(),
      synced_to_cloud: 1,
      save_to_cloud: 0,
      cloud_id: cloudCharacter.id,
      pending_cloud_id: cloudCharacter.id,
      deleted_at: null,
      summary_checkpoint: 0,
      owner_user_id: cloudCharacter.ownerUserId || localUserId,
      voice: normalizeVoice(cloudCharacter.voice),
    },
  ])

  // Download once and re-store under the importer's own account, honouring
  // THEIR privacy mode. The importer's row never references the owner's
  // objects, so a revoked share cannot break their avatar.
  const signedUrl = cloudCharacter.avatarSignedUrl
  if (signedUrl) {
    try {
      await saveCharacterImage({
        characterId: localCharacterId,
        userId: localUserId,
        uri: signedUrl,
        width: IMPORTED_AVATAR_DIMENSION,
        height: IMPORTED_AVATAR_DIMENSION,
        source: 'imported',
      })
    } catch {
      // The dominant failure mode is the 15-minute signed URL expiring
      // between fetch and download. Neither the manipulator's nor the
      // image loader's error reliably carries an HTTP status this far up
      // the stack, so rather than gate the retry on a status code that is
      // usually absent, retry once unconditionally: the character itself
      // already imported successfully, the avatar alone is recoverable,
      // and a single extra request is cheap next to losing the avatar.
      try {
        const retry = await getPublicCharacterFn({ characterId: cloudCharacterId })
        if (retry.data?.avatarSignedUrl) {
          await saveCharacterImage({
            characterId: localCharacterId,
            userId: localUserId,
            uri: retry.data.avatarSignedUrl,
            width: IMPORTED_AVATAR_DIMENSION,
            height: IMPORTED_AVATAR_DIMENSION,
            source: 'imported',
          })
        }
      } catch (retryError) {
        reportError(retryError, 'importSharedCharacter:avatar')
      }
    }
  }

  return { localCharacterId, cloudCharacterId: cloudCharacter.id }
}

/**
 * Remove a character from cloud while keeping the local copy.
 * Clears the local cloud link and sync state after removing the cloud copy when present.
 * If the character has no cloud_id, only clears the local link (noop w.r.t. cloud deletion).
 */
export async function removeCharacterFromCloud(
  localCharacterId: string,
  userId: string,
): Promise<void> {
  const localChar = await getCharacter(localCharacterId, userId)
  if (!localChar) return

  const cloudId =
    localChar.cloud_id && UUID_REGEX.test(localChar.cloud_id) ? localChar.cloud_id : null

  if (!cloudId) {
    // No cloud copy — just clear the link (noop success)
    await clearCharacterCloudLink(localCharacterId, userId)
    return
  }

  // MUST run before clearCharacterCloudLink. That call nulls cloud_id, and
  // cloud_id IS the storage path — clearing it first makes every one of this
  // character's cloud images permanently unreachable. Requires network; the
  // throw propagates so the caller can tell the user to reconnect rather than
  // half-completing the toggle.
  await demoteCharacterImagesToLocal(localCharacterId, userId, cloudId)

  try {
    await deleteCharacterFn({ characterId: cloudId })
  } catch (error: any) {
    // If already not found on cloud, still proceed to clear local link
    const errorCode = typeof error?.code === 'string' ? error.code : ''
    if (errorCode !== 'not-found' && !errorCode.endsWith('/not-found')) {
      throw error
    }
  }

  await clearCharacterCloudLink(localCharacterId, userId)
}

/**
 * Hard-delete any remaining cloud-kind character_images rows for a character
 * whose server-side counterpart has already been purged.
 *
 * `deleteAllImagesForCharacter` marks cloud rows as `pending_delete` so the
 * sweeper can tell the server — but when the server already purged them (via
 * `deleteCharacterHandler`), the sweeper can never map them to a cloud_id
 * because `hardDeleteCharacterLocal` removes the parent character first. This
 * helper runs between those two steps to clean up the rows the sweeper can't
 * reach.
 */
async function hardDeleteCloudImageRows(localCharacterId: string): Promise<void> {
  const rows = await getAllImagesForCharacter(localCharacterId)
  for (const row of rows) {
    if (row.storage_kind === 'cloud') {
      await hardDeleteCharacterImage(row.id)
    }
  }
}

async function syncDeletionsToCloud(localUserId: string): Promise<void> {
  const deleted = await getSoftDeletedCharacters(localUserId)
  if (deleted.length === 0) return

  for (const char of deleted) {
    const cloudId = char.cloud_id && UUID_REGEX.test(char.cloud_id) ? char.cloud_id : null

    if (!cloudId) {
      // Never synced, so there is no server-side purgeCharacter to reach any
      // cloud-kind rows — but privacy-mode 'file'/'inline' rows are entirely
      // local, and hardDeleteCharacterLocal only drops the characters/messages
      // rows. Without this, their bytes and character_images rows outlive the
      // character with nothing left able to find or sweep them.
      await deleteAllImagesForCharacter(char.id, localUserId).catch((error) =>
        reportError(error, 'characterSync:deleteLocalImages'),
      )
      await hardDeleteCharacterLocal(char.id, localUserId)
      continue
    }

    try {
      await deleteCharacterFn({ characterId: cloudId })

      // Cloud deletion confirmed — deleteCharacterHandler already purged the
      // server-side rows and Storage objects, but that leaves this device's
      // local character_images rows (and any 'file'/'inline' bytes on disk)
      // behind, since the server never sees local-only storage kinds.
      await deleteAllImagesForCharacter(char.id, localUserId).catch((error) =>
        reportError(error, 'characterSync:deleteLocalImages'),
      )
      // deleteAllImagesForCharacter marks cloud rows as pending_delete so the
      // sweeper can tell the server — but the server already purged them, and
      // hardDeleteCharacterLocal below removes the parent character the sweeper
      // needs to map cloud_id. Hard-delete the remaining cloud rows directly.
      await hardDeleteCloudImageRows(char.id)
      // Hard-delete locally (also removes messages)
      await hardDeleteCharacterLocal(char.id, localUserId)
    } catch (error: any) {
      // A prior sync could have deleted the cloud copy successfully but been
      // interrupted before hardDeleteCharacterLocal ran — and the
      // deleteAllImagesForCharacter step above widened that window. Treating
      // not-found as failure would leave the character soft-deleted forever,
      // retried every sync, with its character_images rows never purged.
      // removeCharacterFromCloud already treats not-found as success; match it.
      const errorCode = typeof error?.code === 'string' ? error.code : ''
      if (errorCode !== 'not-found' && !errorCode.endsWith('/not-found')) {
        reportWikiOpForCharacter(error, 'characterSync:delete', char.id, 'Character cloud deletion')
        continue
      }

      await deleteAllImagesForCharacter(char.id, localUserId).catch((error) =>
        reportError(error, 'characterSync:deleteLocalImages'),
      )
      await hardDeleteCloudImageRows(char.id)
      await hardDeleteCharacterLocal(char.id, localUserId)
    }
  }
}
