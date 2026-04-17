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
    const normalizedEmail = params.email.toLowerCase();

    const existingByUid = await this.findUserByFirebaseUid(params.firebaseUid);
    if (existingByUid) {
      return existingByUid;
    }

    const [inserted] = await db
      .insert(users)
      .values({
        firebaseUid: params.firebaseUid,
        email: normalizedEmail,
        displayName: params.displayName,
        avatarUrl: params.avatarUrl,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      return inserted;
    }

    const existingUser = await this.findUserByFirebaseUid(params.firebaseUid);
    if (existingUser) {
      return existingUser;
    }

    // Fallback for migration/edge cases where email exists but UID was not linked yet.
    const userByEmail = await this.findUserByEmail(normalizedEmail);
    if (userByEmail) {
      const [updated] = await db
        .update(users)
        .set({ firebaseUid: params.firebaseUid, updatedAt: new Date() })
        .where(eq(users.id, userByEmail.id))
        .returning();
      return updated;
    }

    throw new Error('Failed to get or create user by Firebase identity.');
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
