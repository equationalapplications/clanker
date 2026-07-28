import {and, desc, eq, isNull} from "drizzle-orm";
import {getDb} from "../db/cloudSql.js";
import {characterImages, characters} from "../db/schema.js";
import {storageAdmin} from "./storageAdmin.js";

export const IMAGE_CAP_PER_CHARACTER = 100;

export type CharacterImageRecord = typeof characterImages.$inferSelect;

export type CharacterImageRepository = {
  listByCharacter(characterId: string): Promise<CharacterImageRecord[]>;
  listLiveByCharacter(characterId: string): Promise<CharacterImageRecord[]>;
  upsert(row: typeof characterImages.$inferInsert): Promise<void>;
  tombstone(id: string): Promise<void>;
  getActiveImageId(characterId: string): Promise<string | null>;
  setActiveImageId(characterId: string, imageId: string | null): Promise<void>;
  deleteByCharacter(characterId: string): Promise<void>;
};

export const createCharacterImageRepository = (): CharacterImageRepository => ({
  async listByCharacter(characterId) {
    const db = await getDb();
    return db.select().from(characterImages)
      .where(eq(characterImages.characterId, characterId))
      .orderBy(desc(characterImages.createdAt));
  },
  async listLiveByCharacter(characterId) {
    const db = await getDb();
    return db.select().from(characterImages)
      .where(and(eq(characterImages.characterId, characterId), isNull(characterImages.deletedAt)))
      .orderBy(characterImages.createdAt);
  },
  async upsert(row) {
    const db = await getDb();
    await db.insert(characterImages).values(row).onConflictDoUpdate({
      target: characterImages.id,
      set: {
        storagePath: row.storagePath,
        thumbPath: row.thumbPath ?? null,
        mimeType: row.mimeType ?? "image/webp",
        source: row.source,
      },
    });
  },
  async tombstone(id) {
    const db = await getDb();
    await db.update(characterImages).set({deletedAt: new Date()})
      .where(eq(characterImages.id, id));
  },
  async getActiveImageId(characterId) {
    const db = await getDb();
    const [row] = await db.select({activeImageId: characters.activeImageId})
      .from(characters).where(eq(characters.id, characterId)).limit(1);
    return row?.activeImageId ?? null;
  },
  async setActiveImageId(characterId, imageId) {
    const db = await getDb();
    await db.update(characters).set({activeImageId: imageId})
      .where(eq(characters.id, characterId));
  },
  async deleteByCharacter(characterId) {
    const db = await getDb();
    await db.delete(characterImages).where(eq(characterImages.characterId, characterId));
  },
});

type StorageOps = Pick<typeof storageAdmin, "deleteObjects" | "deletePrefix">;

export const createCharacterImageService = (
  repository: CharacterImageRepository = createCharacterImageRepository(),
  storage: StorageOps = storageAdmin
) => {
  /** Objects backing one row: master plus thumb when present. */
  const objectPathsFor = (row: CharacterImageRecord): string[] =>
    row.thumbPath ? [row.storagePath, row.thumbPath] : [row.storagePath];

  const tombstoneWithObjects = async (row: CharacterImageRecord): Promise<void> => {
    // Bytes before rows: a failure partway leaves a recoverable row pointing at
    // possibly-missing bytes. The reverse would strand objects nothing references.
    await storage.deleteObjects(objectPathsFor(row));
    await repository.tombstone(row.id);
  };

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
      rows: (typeof characterImages.$inferInsert)[]
    ): Promise<{evictedImageIds: string[]}> {
      for (const row of rows) {
        await repository.upsert({...row, characterId, userId});
      }

      const live = await repository.listLiveByCharacter(characterId);
      const excess = live.length - IMAGE_CAP_PER_CHARACTER;
      if (excess <= 0) return {evictedImageIds: []};

      const activeImageId = await repository.getActiveImageId(characterId);
      const evictable = live.filter((row) => row.id !== activeImageId);
      const evicted = evictable.slice(0, excess);

      for (const row of evicted) {
        await tombstoneWithObjects(row);
      }

      return {evictedImageIds: evicted.map((row) => row.id)};
    },

    async deleteImages(characterId: string, userId: string, imageIds: string[]): Promise<void> {
      void userId;
      const rows = await repository.listByCharacter(characterId);
      const targets = rows.filter((row) => imageIds.includes(row.id) && !row.deletedAt);
      for (const row of targets) {
        await tombstoneWithObjects(row);
      }
    },

    /** Includes tombstones — absence is ambiguous, an explicit deleted_at is not. */
    async listImages(characterId: string): Promise<CharacterImageRecord[]> {
      return repository.listByCharacter(characterId);
    },

    async setActiveImage(characterId: string, imageId: string | null): Promise<void> {
      await repository.setActiveImageId(characterId, imageId);
    },

    /**
     * Character hard-delete: the parent is gone, so tombstones have nothing left
     * to reconcile against and the rows go too.
     */
    async purgeCharacter(userId: string, characterId: string): Promise<void> {
      await storage.deletePrefix(`users/${userId}/characters/${characterId}/`);
      await repository.deleteByCharacter(characterId);
    },
  };
};

export const characterImageService = createCharacterImageService();
