import admin from 'firebase-admin'

export interface DeviceUpsertBody {
  fcmToken: string
  deviceId: string
  deviceName: string
  isPaused?: boolean
}

export interface DeviceUpsertFirestore {
  doc(path: string): {
    get(): Promise<{ exists: boolean }>
    set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>
  }
}

export async function upsertDeviceRecord(
  fs: DeviceUpsertFirestore,
  uid: string,
  body: DeviceUpsertBody,
): Promise<void> {
  const ref = fs.doc(`users/${uid}/devices/${body.deviceId}`)
  const now = admin.firestore.Timestamp.now()
  const existing = await ref.get()
  await ref.set({
    fcmToken: body.fcmToken,
    deviceName: body.deviceName,
    active: true,
    lastSeenAt: now,
    ...(body.isPaused !== undefined ? { isPaused: body.isPaused } : {}),
    ...(!existing.exists ? { registeredAt: now } : {}),
  }, { merge: true })
}
