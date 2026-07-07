import { createHash, randomBytes, randomUUID } from 'node:crypto'
import admin from 'firebase-admin'

export interface PairingFirestore {
  doc(path: string): {
    set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
    delete?(): Promise<unknown>
  }
  collection?(path: string): {
    where(field: string, op: string, value: unknown): PairingQuery
  }
}

interface PairingQuery {
  where(field: string, op: string, value: unknown): PairingQuery
  get(): Promise<{ docs: Array<{ id: string; ref: { delete(): Promise<unknown> } }> }>
}

function now() { return admin.firestore?.Timestamp ? admin.firestore.Timestamp.now() : (Date.now() as unknown) }

const pairingPath = (tokenHash: string) => `desktopPairings/${tokenHash}`
const devicePath = (uid: string, deviceId: string) => `users/${uid}/devices/${deviceId}`

/** 32 bytes CSPRNG, base64url — shown to the user exactly once. Never persist or log the raw token. */
export function generatePairingToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') }
}

export async function pairDesktopDevice(
  db: PairingFirestore,
  uid: string,
  deviceName: string,
): Promise<{ pairingToken: string; deviceId: string }> {
  const { token, tokenHash } = generatePairingToken()
  const deviceId = randomUUID()
  await db.doc(devicePath(uid, deviceId)).set({
    deviceId, type: 'desktop', deviceName,
    active: true, isPaused: false, online: false,
    connectedInstanceId: null, lastSeenAt: null,
    registeredAt: now(),
  })
  await db.doc(pairingPath(tokenHash)).set({ uid, deviceId, createdAt: now() })
  return { pairingToken: token, deviceId }
}

export async function resolvePairingToken(
  db: PairingFirestore,
  rawToken: string,
): Promise<{ uid: string; deviceId: string } | null> {
  if (!rawToken || rawToken.length > 128) return null
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const snap = await db.doc(pairingPath(tokenHash)).get()
  if (!snap.exists) return null
  const data = snap.data() as { uid?: string; deviceId?: string }
  if (!data.uid || !data.deviceId) return null
  const device = await db.doc(devicePath(data.uid, data.deviceId)).get()
  if (!device.exists) return null
  return { uid: data.uid, deviceId: data.deviceId }
}

export async function revokeDesktopDevice(db: PairingFirestore, uid: string, deviceId: string): Promise<void> {
  const deviceRef = db.doc(devicePath(uid, deviceId))
  if (deviceRef.delete) await deviceRef.delete()

  if (db.collection) {
    const snap = await db.collection('desktopPairings')
      .where('uid', '==', uid)
      .where('deviceId', '==', deviceId)
      .get()
    for (const doc of snap.docs) {
      await doc.ref.delete()
    }
  }
}
