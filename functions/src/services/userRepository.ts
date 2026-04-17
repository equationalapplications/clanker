import { eq } from 'drizzle-orm';
import { db } from '../db/cloudSql.js';
import { users } from '../db/schema.js';

export interface CreateUserParams {
  firebaseUid: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export const userRepository = {
  async getOrCreateUserByFirebaseIdentity(params: CreateUserParams) {
    const existingUser = await this.findUserByFirebaseUid(params.firebaseUid);
    if (existingUser) {
      return existingUser;
    }

    // Try by email as fallback during migration/edge cases
    const userByEmail = await this.findUserByEmail(params.email);
    if (userByEmail) {
      // If we found them by email but not firebaseUid, update the firebaseUid
      const [updated] = await db
        .update(users)
        .set({ firebaseUid: params.firebaseUid })
        .where(eq(users.id, userByEmail.id))
        .returning();
      return updated;
    }

    // Create new user
    const [newUser] = await db
      .insert(users)
      .values({
        firebaseUid: params.firebaseUid,
        email: params.email,
        displayName: params.displayName,
        avatarUrl: params.avatarUrl,
      })
      .returning();

    return newUser;
  },

  async findUserByEmail(email: string) {
    const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return result[0] || null;
  },

  async findUserByFirebaseUid(firebaseUid: string) {
    const result = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    return result[0] || null;
  },

  async updateUser(userId: string, updates: Partial<typeof users.$inferInsert>) {
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },
};
