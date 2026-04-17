import { eq, sql } from 'drizzle-orm';
import { db } from '../db/cloudSql.js';
import { characters, messages } from '../db/schema.js';

export const characterService = {
  async getUserCharacterCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(characters)
      .where(eq(characters.userId, userId));
    
    return result[0]?.count ?? 0;
  },

  async getCharacterMessageCount(characterId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.characterId, characterId));
    
    return result[0]?.count ?? 0;
  },

  async upsertCharacter(character: typeof characters.$inferInsert) {
    const [upserted] = await db
      .insert(characters)
      .values(character)
      .onConflictDoUpdate({
        target: characters.id,
        set: {
          name: character.name,
          avatar: character.avatar,
          appearance: character.appearance,
          traits: character.traits,
          emotions: character.emotions,
          context: character.context,
          isPublic: character.isPublic,
          updatedAt: character.updatedAt ?? new Date(),
        },
      })
      .returning();
    return upserted;
  },

  async deleteCharacter(characterId: string, userId: string) {
    await db
      .delete(characters)
      .where(sql`${characters.id} = ${characterId} AND ${characters.userId} = ${userId}`);
  },

  async getUserCharacters(userId: string) {
    return await db
      .select()
      .from(characters)
      .where(eq(characters.userId, userId))
      .orderBy(sql`${characters.updatedAt} DESC`);
  },
};
