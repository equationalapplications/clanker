import { eq } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { users } from '../db/schema.js';

export interface CreateUserParams {
  firebaseUid: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

interface UserRepositoryDeps {
  getDb: typeof getDb;
}

const defaultDeps: UserRepositoryDeps = {
  getDb,
};

export const userRepository = {
  async getOrCreateUserByFirebaseIdentity(
    params: CreateUserParams,
    deps: UserRepositoryDeps = defaultDeps
  ) {
    const normalizedEmail = params.email.toLowerCase();

    const existingByUid = await this.findUserByFirebaseUid(params.firebaseUid, deps);
    if (existingByUid) {
      return existingByUid;
    }

    const db = await deps.getDb();

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

    const existingUser = await this.findUserByFirebaseUid(params.firebaseUid, deps);
    if (existingUser) {
      return existingUser;
    }

    const existingByEmail = await this.findUserByEmail(normalizedEmail, deps);
    if (existingByEmail) {
      if (existingByEmail.firebaseUid !== params.firebaseUid) {
        throw new Error('Existing user email is linked to a different Firebase UID.');
      }

      return existingByEmail;
    }

    throw new Error('Failed to get or create user by Firebase identity.');
  },

  async findUserByEmail(email: string, deps: UserRepositoryDeps = defaultDeps) {
    const db = await deps.getDb();
    const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return result[0] || null;
  },

  async findUserByFirebaseUid(firebaseUid: string, deps: UserRepositoryDeps = defaultDeps) {
    const db = await deps.getDb();
    const result = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
    return result[0] || null;
  },

  async updateUser(
    userId: string,
    updates: Partial<typeof users.$inferInsert>,
    deps: UserRepositoryDeps = defaultDeps
  ) {
    const db = await deps.getDb();
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated ?? null;
  },
};
