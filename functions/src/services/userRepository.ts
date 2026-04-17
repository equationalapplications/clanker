import { eq } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { users } from '../db/schema.js';

export interface CreateUserParams {
  firebaseUid: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export const userRepository = {
  async getOrCreateUserByFirebaseIdentity(params: CreateUserParams) {
    const db = await getDb();
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

    throw new Error('Failed to get or create user by Firebase identity.');
  },

  async findUserByEmail(email: string) {
    const db = await getDb();
    const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return result[0] || null;
  },

  async findUserByFirebaseUid(firebaseUid: string) {
    const db = await getDb();
    const result = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    return result[0] || null;
  },

  async updateUser(userId: string, updates: Partial<typeof users.$inferInsert>) {
    const db = await getDb();
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },
};
