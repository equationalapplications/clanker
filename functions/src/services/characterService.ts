import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { characters, messages } from '../db/schema.js';

type CharacterUpdateInput = Pick<
  typeof characters.$inferInsert,
  'name' | 'avatar' | 'appearance' | 'traits' | 'emotions' | 'context' | 'isPublic' | 'updatedAt'
>;

export function buildCharacterUpdateValues(character: CharacterUpdateInput) {
  const updateValues = {
    name: character.name,
    avatar: character.avatar,
    appearance: character.appearance,
    traits: character.traits,
    emotions: character.emotions,
    context: character.context,
    updatedAt: character.updatedAt ?? new Date(),
  };

  if (character.isPublic === undefined) {
    return updateValues;
  }

  return {
    ...updateValues,
    isPublic: character.isPublic,
  };
}

interface CharacterServiceDeps {
  getDb: typeof getDb;
}

export const createCharacterService = (
  deps: CharacterServiceDeps = { getDb },
) => {
  const service = {
    async getUserCharacterCount(userId: string): Promise<number> {
      const db = await deps.getDb();
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(characters)
        .where(eq(characters.userId, userId));

      return result[0]?.count ?? 0;
    },

    async getCharacterMessageCount(characterId: string): Promise<number> {
      const db = await deps.getDb();
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(eq(messages.characterId, characterId));

      return result[0]?.count ?? 0;
    },

    async upsertCharacter(character: typeof characters.$inferInsert, userId: string) {
      const db = await deps.getDb();

      // If character has an ID, either update owned rows or insert a new row with that ID.
      // Here character.id is the remote cloud character ID (UUID), which is tracked
      // separately from local SQLite IDs (e.g. char_<timestamp>_<random>). This keeps
      // cloud_id-based sync stable while still blocking cross-user overwrites.
      if (character.id) {
        const [upserted] = await db
          .insert(characters)
          .values({
            ...character,
            userId,
          })
          .onConflictDoUpdate({
            target: characters.id,
            set: buildCharacterUpdateValues(character),
            where: eq(characters.userId, userId),
          })
          .returning();

        if (!upserted) {
          const existing = await db
            .select()
            .from(characters)
            .where(eq(characters.id, character.id))
            .limit(1);

          if (existing[0] && existing[0].userId !== userId) {
            throw new Error('Character does not belong to user');
          }

          if (existing[0]) {
            return existing[0];
          }

          throw new Error('Failed to upsert character');
        }

        return upserted;
      }

      // Insert new character and always enforce owner from explicit parameter.
      const [inserted] = await db
        .insert(characters)
        .values({
          ...character,
          userId,
        })
        .returning();
      return inserted;
    },

    async deleteCharacter(characterId: string, userId: string) {
      const db = await deps.getDb();

      const existing = await db
        .select()
        .from(characters)
        .where(eq(characters.id, characterId))
        .limit(1);

      if (existing[0] && existing[0].userId !== userId) {
        throw new Error('Character does not belong to user');
      }

      await db
        .delete(characters)
        .where(sql`${characters.id} = ${characterId} AND ${characters.userId} = ${userId}`);
    },

    async getUserCharacters(userId: string) {
      const db = await deps.getDb();
      return await db
        .select()
        .from(characters)
        .where(eq(characters.userId, userId))
        .orderBy(sql`${characters.updatedAt} DESC`);
    },

    async getPublicCharacterById(characterId: string) {
      const db = await deps.getDb();
      const result = await db
        .select()
        .from(characters)
        .where(sql`${characters.id} = ${characterId} AND ${characters.isPublic} = true`)
        .limit(1);
      return result[0] ?? null;
    },
  };

  return service;
};

export const characterService = createCharacterService();
