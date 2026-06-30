import admin from 'firebase-admin'
import type { TaskIntent, TaskResult, SessionDoc, TaskDoc, DeviceDoc, AuthDoc } from '../../../shared/dsl-types.js'

export interface FirestoreBatch {
  update(path: string, data: Record<string, unknown>): void
  set(path: string, data: Record<string, unknown>): void
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

function timestampMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number }
    if (typeof ts.toMillis === 'function') return ts.toMillis()
    if (typeof ts.seconds === 'number') return ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1e6
  }
  return null
}

function isSessionExpired(session: SessionDoc, nowMs = Date.now()): boolean {
  const expiresMs = timestampMs(session.expiresAt)
  return expiresMs !== null && expiresMs <= nowMs
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
        .limit(50)
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

    /** Abort a pending task only if it has not connected yet. Returns true when aborted. */
    async abortPendingTaskIfOffline(
      uid: string,
      sid: string,
      tid: string,
      result: TaskResult,
    ): Promise<boolean> {
      const task = await this.getTask(uid, sid, tid)
      if (task.status !== 'pending') return false
      const session = await this.getSession(uid, sid)
      const connected = session.browserInstanceId != null || session.browserConnectedAt != null
      if (connected) return false
      await this.writeTaskResult(uid, sid, tid, result)
      return true
    },

    // Per-task listener. Returns unsubscribe. Used by the voice-side instance.
    watchTask(uid: string, sid: string, tid: string, cb: (task: TaskDoc) => void): () => void {
      const ref = db.doc(taskPath(uid, sid, tid))
      if (!ref.onSnapshot) throw new Error('watchTask requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as TaskDoc)
      })
    },

    async haltForAuth(uid: string, sid: string, tid: string, haltedStepIndex: number, actionSummary: string, partialData?: Record<string, string>, partialActiveUrl?: string): Promise<void> {
      const AUTH_TTL_MS = 5 * 60 * 1000
      const authPath = `users/${uid}/sessions/${sid}/auth/${tid}`
      const expiresAt = admin.firestore?.Timestamp
        ? admin.firestore.Timestamp.fromMillis(Date.now() + AUTH_TTL_MS)
        : (Date.now() + AUTH_TTL_MS as unknown)
      const authDoc = { status: 'pending', actionSummary, expiresAt, approvedAt: null, approvalToken: null }
      const taskUpdate = { status: 'awaiting_auth', haltedStepIndex, partialData: partialData ?? {}, partialActiveUrl: partialActiveUrl ?? '', updatedAt: now() }

      if (db.batch) {
        const batch = db.batch()
        batch.update(taskPath(uid, sid, tid), taskUpdate)
        batch.update(sessionPath(uid, sid), { status: 'pending_auth' })
        batch.set(authPath, authDoc)
        await batch.commit()
      } else {
        await db.doc(taskPath(uid, sid, tid)).update(taskUpdate)
        await db.doc(sessionPath(uid, sid)).update({ status: 'pending_auth' })
        await db.doc(authPath).set(authDoc)
      }
    },

    watchAuth(uid: string, sid: string, tid: string, cb: (auth: AuthDoc) => void): () => void {
      const authPath = `users/${uid}/sessions/${sid}/auth/${tid}`
      const ref = db.doc(authPath)
      if (!ref.onSnapshot) throw new Error('watchAuth requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as AuthDoc)
      })
    },

    async getPendingSchedulerSession(uid: string): Promise<{ sessionId: string; taskId: string | null } | null> {
      const snap = await db.collection(`users/${uid}/sessions`)
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'asc')
        .limit(10)
        .get()
      if (snap.empty) return null
      for (const doc of snap.docs) {
        const session = doc.data() as unknown as SessionDoc
        if (isSessionExpired(session)) continue
        const sid = doc.id
        const taskSnap = await db.collection(`users/${uid}/sessions/${sid}/tasks`).limit(1).get()
        if (taskSnap.empty) continue
        return { sessionId: sid, taskId: taskSnap.docs[0].id }
      }
      return null
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
        set(path: string, data: Record<string, unknown>) {
          batch.set(raw.doc(path), data)
        },
        commit: async () => { await batch.commit() },
      }
    },
  }
  return createFirestoreSession(db)
}
