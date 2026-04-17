import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { characters, messages } from '../db/schema.js';

export const characterService = {
  async getUserCharacterCount(userId: string): Promise<number> {
    const db = await getDb();
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(characters)
      .where(eq(characters.userId, userId));
    
    return result[0]?.count ?? 0;
  },

  async getCharacterMessageCount(characterId: string): Promise<number> {
    const db = await getDb();
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.characterId, characterId));
    
    return result[0]?.count ?? 0;
  },

  async upsertCharacter(character: typeof characters.$inferInsert, userId: string) {
    const db = await getDb();
    
    // If character has an ID, verify ownership before upserting
    if (character.id) {
      const existing = await db
        .select()
        .from(characters)
        .where(
          sql`${characters.id} = ${character.id} AND ${characters.userId} = ${userId}`
        )
        .limit(1);
      
      if (!existing[0]) {
        throw new Error('Character not found or does not belong to user');
      }
      
      // Update existing character
      const [updated] = await db
        .update(characters)
        .set({
          name: character.name,
          avatar: character.avatar,
          appearance: character.appearance,
          traits: character.traits,
          emotions: character.emotions,
          context: character.context,
          isPublic: character.isPublic,
          updatedAt: character.updatedAt ?? new Date(),
        })
        .where(
          sql`${characters.id} = ${character.id} AND ${characters.userId} = ${userId}`
        )
        .returning();
      return updated;
    }
    
    // Insert new character (userId already set in character object)
    const [inserted] = await db
      .insert(characters)
      .values(character)
      .returning();
    return inserted;
  },

  async deleteCharacter(characterId: string, userId: string) {
    const db = await getDb();
    await db
      .delete(characters)
      .where(sql`${characters.id} = ${characterId} AND ${characters.userId} = ${userId}`);
  },

  async getUserCharacters(userId: string) {
    const db = await getDb();
    return await db
      .select()
      .from(characters)
      .where(eq(characters.userId, userId))
      .orderBy(sql`${characters.updatedAt} DESC`);
  },
};
