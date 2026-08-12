import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { getDb } from '../db/cloudSql.js'
import { characterImages, characters } from '../db/schema.js'
import { storageAdmin } from './storageAdmin.js'

export const IMAGE_CAP_PER_CHARACTER = 100

export type CharacterImageRecord = typeof characterImages.$inferSelect

export type CharacterImageRepository = {
  listByCharacter(characterId: string): Promise<CharacterImageRecord[]>
  listByCharacters(characterIds: string[]): Promise<CharacterImageRecord[]>
  listLiveByCharacter(characterId: string): Promise<CharacterImageRecord[]>
  upsert(row: typeof characterImages.$inferInsert): Promise<void>
  tombstone(id: string): Promise<void>
  getActiveImageId(characterId: string): Promise<string | null>
  setActiveImageId(characterId: string, imageId: string | null): Promise<void>
  deleteByCharacter(characterId: string, userId: string): Promise<void>
  deleteTombstonesOlderThan(cutoff: Date): Promise<number>
}

export const createCharacterImageRepository = (): CharacterImageRepository => ({
  async listByCharacter(characterId) {
    const db = await getDb()
    return db
      .select()
      .from(characterImages)
      .where(eq(characterImages.characterId, characterId))
      .orderBy(desc(characterImages.createdAt))
  },
  async listByCharacters(characterIds) {
    if (characterIds.length === 0) return []
    const db = await getDb()
    return db
      .select()
      .from(characterImages)
      .where(inArray(characterImages.characterId, characterIds))
      .orderBy(desc(characterImages.createdAt))
  },
  async listLiveByCharacter(characterId) {
    const db = await getDb()
    return db
      .select()
      .from(characterImages)
      .where(and(eq(characterImages.characterId, characterId), isNull(characterImages.deletedAt)))
      .orderBy(characterImages.createdAt)
  },
  async upsert(row) {
    const db = await getDb()
    // setWhere is the ownership boundary on the conflict path. The id is a
    // client-chosen UUID, so without it a caller who guesses (or replays) an id
    // belonging to someone else would overwrite that row's storage paths — the
    // upstream ownership check only covers the characterId, not the image id.
    // Comparing the *existing* row's owner against the incoming one makes a
    // foreign id a silent no-op instead of a takeover.
    //
    // Known limitation: the client never sends a createdAt, so first-insert
    // rows take the column default (now()) rather than the image's actual
    // local creation time. The FIFO cap therefore evicts by registration order,
    // not by when the image was made — a backlog of week-old offline images
    // synced together looks newest. Not plumbed through: it would mean
    // trusting a client-supplied timestamp for an ordering that deletes data.
    await db
      .insert(characterImages)
      .values(row)
      .onConflictDoUpdate({
        target: characterImages.id,
        set: {
          storagePath: row.storagePath,
          thumbPath: row.thumbPath ?? null,
          mimeType: row.mimeType ?? 'image/webp',
          source: row.source,
          messageId: row.messageId ?? null,
        },
        setWhere: and(
          eq(characterImages.userId, row.userId),
          eq(characterImages.characterId, row.characterId),
        ),
      })
  },
  async tombstone(id) {
    const db = await getDb()
    await db
      .update(characterImages)
      .set({ deletedAt: new Date() })
      .where(eq(characterImages.id, id))
  },
  async getActiveImageId(characterId) {
    const db = await getDb()
    const [row] = await db
      .select({ activeImageId: characters.activeImageId })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1)
    return row?.activeImageId ?? null
  },
  async setActiveImageId(characterId, imageId) {
    const db = await getDb()
    await db
      .update(characters)
      .set({ activeImageId: imageId })
      .where(eq(characters.id, characterId))
  },
  async deleteByCharacter(characterId, userId) {
    const db = await getDb()
    // Scoped by user_id as well as character_id: this must never be reachable
    // for a characterId the caller does not own, even if an ownership check
    // upstream is ever skipped or reordered. See §10.1 of the design spec.
    await db
      .delete(characterImages)
      .where(and(eq(characterImages.characterId, characterId), eq(characterImages.userId, userId)))
  },
  async deleteTombstonesOlderThan(cutoff) {
    const db = await getDb()
    // The Storage objects behind a tombstoned row are already deleted at
    // tombstone time (see tombstoneWithObjects below) — this only drops the
    // now-unreferenced row itself, tens of bytes each.
    const deleted = await db
      .delete(characterImages)
      .where(and(isNotNull(characterImages.deletedAt), lt(characterImages.deletedAt, cutoff)))
      .returning({ id: characterImages.id })
    return deleted.length
  },
})

type StorageOps = Pick<typeof storageAdmin, 'deleteObjects' | 'deletePrefix'>

export const createCharacterImageService = (
  repository: CharacterImageRepository = createCharacterImageRepository(),
  storage: StorageOps = storageAdmin,
) => {
  /** Objects backing one row: master plus thumb when present. */
  const objectPathsFor = (row: CharacterImageRecord): string[] =>
    row.thumbPath ? [row.storagePath, row.thumbPath] : [row.storagePath]

  const tombstoneWithObjects = async (row: CharacterImageRecord): Promise<void> => {
    // Bytes before rows: a failure partway leaves a recoverable row pointing at
    // possibly-missing bytes. The reverse would strand objects nothing references.
    await storage.deleteObjects(objectPathsFor(row))
    await repository.tombstone(row.id)
  }

  return {
    /**
     * Upsert the client's new rows, then enforce the cap.
     *
     * The cap lives here, not on the client: two devices can each hold fewer
     * than 100 images while the cloud total exceeds it, so no single client can
     * see the whole set. Evicted ids come back so the caller can apply the same
     * deletion locally without waiting for the next reconciliation.
     */
    async syncImages(
      characterId: string,
      userId: string,
      rows: (typeof characterImages.$inferInsert)[],
    ): Promise<{ evictedImageIds: string[] }> {
      for (const row of rows) {
        await repository.upsert({ ...row, characterId, userId })
      }

      const live = await repository.listLiveByCharacter(characterId)
      const excess = live.length - IMAGE_CAP_PER_CHARACTER
      if (excess <= 0) return { evictedImageIds: [] }

      const activeImageId = await repository.getActiveImageId(characterId)
      const evictable = live.filter((row) => row.id !== activeImageId)
      const evicted = evictable.slice(0, excess)

      for (const row of evicted) {
        await tombstoneWithObjects(row)
      }

      return { evictedImageIds: evicted.map((row) => row.id) }
    },

    async deleteImages(characterId: string, userId: string, imageIds: string[]): Promise<void> {
      // The caller (syncCharacterImagesHandler) has already verified characterId
      // belongs to userId, so every row under it already carries userId — this
      // filter is defense in depth against that check ever being skipped or
      // reordered, matching deleteByCharacter's own scoping above.
      const rows = await repository.listByCharacter(characterId)
      const targets = rows.filter(
        (row) => row.userId === userId && imageIds.includes(row.id) && !row.deletedAt,
      )
      for (const row of targets) {
        await tombstoneWithObjects(row)
      }
    },

    /** Includes tombstones — absence is ambiguous, an explicit deleted_at is not. */
    async listImages(characterId: string): Promise<CharacterImageRecord[]> {
      return repository.listByCharacter(characterId)
    },

    /**
     * Batched form of listImages for a whole character set — getUserCharacters
     * previously ran one listImages query per character (N+1) to attach each
     * one's gallery.
     */
    async listImagesByCharacters(characterIds: string[]): Promise<CharacterImageRecord[]> {
      return repository.listByCharacters(characterIds)
    },

    async setActiveImage(characterId: string, imageId: string | null): Promise<void> {
      await repository.setActiveImageId(characterId, imageId)
    },

    /**
     * Character hard-delete: the parent is gone, so tombstones have nothing left
     * to reconcile against and the rows go too.
     *
     * Rows before objects, deliberately: if the DB delete throws, no Storage
     * object has been touched yet and the caller's error propagates before
     * `characterService.deleteCharacter` runs, so nothing is orphaned. The
     * reverse order would risk a rare but real gap — Storage succeeds, the row
     * delete then throws, and the character survives with rows pointing at
     * objects that no longer exist and no tombstone to trigger cleanup (the
     * cascade backstop only fires when the character row itself is deleted,
     * which never happens on this path). If Storage deletion fails after the
     * rows are gone, the objects are merely orphaned bytes — safe to reap later,
     * not a dangling reference a client can trip over.
     *
     * The caller must assert ownership of `characterId` before calling this —
     * see `characterService.assertCharacterOwnership`. `dbUserId` additionally
     * scopes the row delete as defense in depth against that check ever being
     * skipped or reordered.
     */
    async purgeCharacter(
      firebaseUid: string,
      dbUserId: string,
      characterId: string,
    ): Promise<void> {
      await repository.deleteByCharacter(characterId, dbUserId)
      await storage.deletePrefix(`users/${firebaseUid}/characters/${characterId}/`)
    },

    /**
     * Drop tombstones older than the retention window (spec §3.2: 30 days).
     * Storage objects are already gone by the time a row is tombstoned — this
     * exists purely so the table doesn't grow unbounded with dead rows.
     */
    async sweepExpiredTombstones(retentionDays: number): Promise<number> {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      return repository.deleteTombstonesOlderThan(cutoff)
    },
  }
}

export const characterImageService = createCharacterImageService()
