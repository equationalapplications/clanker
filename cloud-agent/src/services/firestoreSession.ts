import admin from 'firebase-admin'
import type { TaskIntent, TaskResult, SessionDoc, TaskDoc, DeviceDoc } from '../../../shared/dsl-types.js'

export interface FirestoreBatch {
  update(path: string, data: Record<string, unknown>): void
  commit(): Promise<void>
}

// Structural subset of firebase-admin Firestore we use. Lets tests inject a fake.
export interface FirestoreLike {
  doc(path: string): {
    set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
    update(data: Record<string, unknown>): Promise<unknown>
    onSnapshot?(cb: (snap: { exists: boolean; data(): Record<string, unknown> | undefined }) => void): () => void
  }
  collection(path: string): CollectionQuery
  batch?(): FirestoreBatch
}

export interface CollectionQuery {
  where(field: string, op: string, value: unknown): CollectionQuery
  orderBy(field: string, dir: 'asc' | 'desc'): CollectionQuery
  limit(n: number): CollectionQuery
  get(): Promise<{ empty: boolean; docs: Array<{ id: string; data(): Record<string, unknown> }> }>
}

export interface SessionMeta {
  status: SessionDoc['status']
  trigger: SessionDoc['trigger']
  voiceInstanceId: string
}

const SESSION_TTL_MS = 30 * 60 * 1000

function now() { return admin.firestore?.Timestamp ? admin.firestore.Timestamp.now() : (Date.now() as unknown) }
function ttl() {
  return admin.firestore?.Timestamp
    ? admin.firestore.Timestamp.fromMillis(Date.now() + SESSION_TTL_MS)
    : (Date.now() + SESSION_TTL_MS as unknown)
}

export function createFirestoreSession(db: FirestoreLike) {
  const sessionPath = (uid: string, sid: string) => `users/${uid}/sessions/${sid}`
  const taskPath = (uid: string, sid: string, tid: string) => `users/${uid}/sessions/${sid}/tasks/${tid}`
  const devicesPath = (uid: string) => `users/${uid}/devices`

  return {
    async getActiveDevice(uid: string): Promise<{ deviceId: string; fcmToken: string; deviceName: string } | null> {
      const snap = await db.collection(devicesPath(uid))
        .where('active', '==', true)
        .orderBy('lastSeenAt', 'desc')
        .limit(10)
        .get()
      const eligible = snap.docs.filter((d) => {
        const data = d.data() as unknown as DeviceDoc
        return data.isPaused !== true
      })
      if (eligible.length === 0) return null
      const d = eligible[0]
      const data = d.data() as unknown as DeviceDoc
      return { deviceId: d.id, fcmToken: data.fcmToken, deviceName: data.deviceName }
    },

    async createSession(uid: string, sid: string, meta: SessionMeta): Promise<void> {
      await db.doc(sessionPath(uid, sid)).set({
        status: meta.status, trigger: meta.trigger, voiceInstanceId: meta.voiceInstanceId,
        browserInstanceId: null, browserConnectedAt: null, createdAt: now(), expiresAt: ttl(),
      })
    },

    async getSession(uid: string, sid: string): Promise<SessionDoc> {
      const doc = await db.doc(sessionPath(uid, sid)).get()
      if (!doc.exists) throw new Error('SESSION_NOT_FOUND')
      return doc.data() as unknown as SessionDoc
    },

    async markBrowserConnected(uid: string, sid: string, browserInstanceId: string, taskId: string): Promise<void> {
      const sessionUpdate = {
        status: 'routing', browserInstanceId, browserConnectedAt: now(),
      }
      const taskUpdate = { status: 'executing', updatedAt: now() }
      if (db.batch) {
        const batch = db.batch()
        batch.update(sessionPath(uid, sid), sessionUpdate)
        batch.update(taskPath(uid, sid, taskId), taskUpdate)
        await batch.commit()
        return
      }
      await db.doc(sessionPath(uid, sid)).update(sessionUpdate)
      await db.doc(taskPath(uid, sid, taskId)).update(taskUpdate)
    },

    async closeSession(uid: string, sid: string, status: 'closed' | 'aborted'): Promise<void> {
      await db.doc(sessionPath(uid, sid)).update({ status })
    },

    async writeTask(uid: string, sid: string, tid: string, intent: TaskIntent): Promise<void> {
      await db.doc(taskPath(uid, sid, tid)).set({
        status: 'pending', intent, result: null, error: null,
        authRequired: intent.requiresAuth, haltedStepIndex: null, createdAt: now(), updatedAt: now(),
      })
    },

    async getTask(uid: string, sid: string, tid: string): Promise<TaskDoc> {
      const doc = await db.doc(taskPath(uid, sid, tid)).get()
      if (!doc.exists) throw new Error('TASK_NOT_FOUND')
      return doc.data() as unknown as TaskDoc
    },

    async getFirstTask(uid: string, sid: string): Promise<TaskDoc | null> {
      const snap = await db.collection(`users/${uid}/sessions/${sid}/tasks`).limit(1).get()
      if (snap.empty) return null
      return snap.docs[0].data() as unknown as TaskDoc
    },

    async writeTaskResult(uid: string, sid: string, tid: string, result: TaskResult): Promise<void> {
      await db.doc(taskPath(uid, sid, tid)).update({
        status: result.status, result, error: result.error ?? null, updatedAt: now(),
      })
    },

    // Per-task listener. Returns unsubscribe. Used by the voice-side instance.
    watchTask(uid: string, sid: string, tid: string, cb: (task: TaskDoc) => void): () => void {
      const ref = db.doc(taskPath(uid, sid, tid))
      if (!ref.onSnapshot) throw new Error('watchTask requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as TaskDoc)
      })
    },
  }
}

export type FirestoreSession = ReturnType<typeof createFirestoreSession>

export function defaultFirestoreSession(): FirestoreSession {
  const raw = admin.firestore()
  const db: FirestoreLike = {
    doc: (path) => raw.doc(path) as FirestoreLike['doc'] extends (p: string) => infer R ? R : never,
    collection: (path) => raw.collection(path) as unknown as CollectionQuery,
    batch: () => {
      const batch = raw.batch()
      return {
        update(path: string, data: Record<string, unknown>) {
          batch.update(raw.doc(path), data)
        },
        commit: async () => { await batch.commit() },
      }
    },
  }
  return createFirestoreSession(db)
}
