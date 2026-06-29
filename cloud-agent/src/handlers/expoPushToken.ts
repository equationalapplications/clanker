import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { users } from '../db/schema.js'
import type * as schema from '../db/schema.js'

export async function upsertExpoPushToken(
  db: NodePgDatabase<typeof schema>,
  firebaseUid: string,
  expoPushToken: string,
): Promise<void> {
  await db.update(users).set({ expoPushToken }).where(eq(users.firebaseUid, firebaseUid))
}

export async function getExpoPushToken(
  db: NodePgDatabase<typeof schema>,
  firebaseUid: string,
): Promise<string | null> {
  const rows = await db.select({ expoPushToken: users.expoPushToken })
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1)
  return rows[0]?.expoPushToken ?? null
}
