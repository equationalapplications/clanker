import admin from 'firebase-admin'
import type {
  TaskIntent,
  TaskResult,
  SessionDoc,
  TaskDoc,
  DeviceDoc,
  AuthDoc,
} from '../../../shared/dsl-types.js'

export interface FirestoreBatch {
  update(path: string, data: Record<string, unknown>): void
  set(path: string, data: Record<string, unknown>): void
  commit(): Promise<void>
}

// Structural subset of firebase-admin Firestore we use. Lets tests inject a fake.
export interface FirestoreLike {
  doc(path: string): {
    set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>
    create?(data: Record<string, unknown>): Promise<unknown>
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
    update(data: Record<string, unknown>): Promise<unknown>
    onSnapshot?(
      cb: (snap: { exists: boolean; data(): Record<string, unknown> | undefined }) => void,
    ): () => void
  }
  collection(path: string): CollectionQuery
  batch?(): FirestoreBatch
}

export interface CollectionQuery {
  where(field: string, op: string, value: unknown): CollectionQuery
  orderBy(field: string, dir: 'asc' | 'desc'): CollectionQuery
  limit(n: number): CollectionQuery
  get(): Promise<{ empty: boolean; docs: Array<{ id: string; data(): Record<string, unknown> }> }>
  onSnapshot?(
    cb: (docs: Array<{ id: string; data(): Record<string, unknown> }>) => void,
  ): () => void
}

export interface SessionMeta {
  status: SessionDoc['status']
  trigger: SessionDoc['trigger']
  voiceInstanceId: string
}

export interface DesktopTaskError {
  code: 'DESKTOP_TIMEOUT' | 'DESKTOP_DISCONNECTED' | 'TOOL_ERROR'
  message: string
}

export interface DesktopTaskDoc {
  taskId: string
  deviceId: string
  status: 'pending' | 'executing' | 'complete' | 'failed'
  tool: string
  params: Record<string, unknown>
  result: unknown
  error: DesktopTaskError | null
}

const SESSION_TTL_MS = 30 * 60 * 1000
const DESKTOP_TASK_TTL_MS = 60 * 60 * 1000
const DESKTOP_LIVENESS_MS = 90 * 1000

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const t = v as { toMillis?: () => number } | null
  return t?.toMillis?.() ?? 0
}

function now() {
  return admin.firestore?.Timestamp ? admin.firestore.Timestamp.now() : (Date.now() as unknown)
}
function ttl() {
  return admin.firestore?.Timestamp
    ? admin.firestore.Timestamp.fromMillis(Date.now() + SESSION_TTL_MS)
    : ((Date.now() + SESSION_TTL_MS) as unknown)
}

export function createFirestoreSession(db: FirestoreLike) {
  const sessionPath = (uid: string, sid: string) => `users/${uid}/sessions/${sid}`
  const taskPath = (uid: string, sid: string, tid: string) =>
    `users/${uid}/sessions/${sid}/tasks/${tid}`
  const devicesPath = (uid: string) => `users/${uid}/devices`
  const desktopTasksPath = (uid: string) => `users/${uid}/desktopTasks`
  const desktopTaskPath = (uid: string, tid: string) => `users/${uid}/desktopTasks/${tid}`
  const schedulerRunPath = (uid: string, runKey: string) => `users/${uid}/schedulerRuns/${runKey}`

  return {
    async getActiveDevice(
      uid: string,
    ): Promise<{ deviceId: string; fcmToken: string; deviceName: string } | null> {
      const snap = await db
        .collection(devicesPath(uid))
        .where('active', '==', true)
        .orderBy('lastSeenAt', 'desc')
        .limit(50)
        .get()
      const eligible = snap.docs.filter((d) => {
        const data = d.data() as unknown as DeviceDoc & { type?: string }
        return data.isPaused !== true && data.type !== 'desktop'
      })
      if (eligible.length === 0) return null
      const d = eligible[0]
      const data = d.data() as unknown as DeviceDoc
      return { deviceId: d.id, fcmToken: data.fcmToken, deviceName: data.deviceName }
    },

    async getActiveDesktopDevice(
      uid: string,
    ): Promise<{ deviceId: string; deviceName: string } | null> {
      const snap = await db
        .collection(devicesPath(uid))
        .where('active', '==', true)
        .orderBy('lastSeenAt', 'desc')
        .limit(50)
        .get()
      const eligible = snap.docs.filter((d) => {
        const data = d.data() as Record<string, unknown>
        return (
          data.type === 'desktop' &&
          data.isPaused !== true &&
          data.online === true &&
          Date.now() - toMillis(data.lastSeenAt) <= DESKTOP_LIVENESS_MS
        )
      })
      if (eligible.length === 0) return null
      const d = eligible[0]
      return { deviceId: d.id, deviceName: (d.data() as { deviceName?: string }).deviceName ?? '' }
    },

    async getDesktopDeviceDoc(
      uid: string,
      deviceId: string,
    ): Promise<{ exists: boolean; isPaused: boolean }> {
      const doc = await db.doc(`${devicesPath(uid)}/${deviceId}`).get()
      if (!doc.exists) return { exists: false, isPaused: false }
      const data = doc.data() as { isPaused?: boolean } | undefined
      return { exists: true, isPaused: data?.isPaused === true }
    },

    watchDesktopDeviceDoc(
      uid: string,
      deviceId: string,
      cb: (doc: { exists: boolean; isPaused: boolean }) => void,
    ): () => void {
      const ref = db.doc(`${devicesPath(uid)}/${deviceId}`)
      if (!ref.onSnapshot) throw new Error('watchDesktopDeviceDoc requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (!snap.exists) {
          cb({ exists: false, isPaused: false })
          return
        }
        const data = snap.data() as { isPaused?: boolean } | undefined
        cb({ exists: true, isPaused: data?.isPaused === true })
      })
    },

    async createDesktopTask(
      uid: string,
      taskId: string,
      deviceId: string,
      tool: string,
      params: Record<string, unknown>,
    ): Promise<void> {
      const expiresAt = admin.firestore?.Timestamp
        ? admin.firestore.Timestamp.fromMillis(Date.now() + DESKTOP_TASK_TTL_MS)
        : ((Date.now() + DESKTOP_TASK_TTL_MS) as unknown)
      await db.doc(desktopTaskPath(uid, taskId)).set({
        taskId,
        deviceId,
        status: 'pending',
        tool,
        params,
        result: null,
        error: null,
        createdAt: now(),
        updatedAt: now(),
        expiresAt,
      })
    },

    async markDesktopTaskExecuting(uid: string, taskId: string): Promise<boolean> {
      const ref = db.doc(desktopTaskPath(uid, taskId))
      const snap = await ref.get()
      if (!snap.exists) return false
      const current = snap.data() as unknown as DesktopTaskDoc
      if (current.status === 'complete' || current.status === 'failed') return false
      await ref.update({ status: 'executing', updatedAt: now() })
      return true
    },

    async writeDesktopTaskResult(
      uid: string,
      taskId: string,
      outcome:
        { status: 'complete'; result: unknown } | { status: 'failed'; error: DesktopTaskError },
    ): Promise<boolean> {
      const ref = db.doc(desktopTaskPath(uid, taskId))
      const snap = await ref.get()
      if (!snap.exists) return false
      const current = snap.data() as unknown as DesktopTaskDoc
      if (current.status === 'complete' || current.status === 'failed') return false
      await ref.update(
        outcome.status === 'complete'
          ? { status: 'complete', result: outcome.result, updatedAt: now() }
          : { status: 'failed', error: outcome.error, updatedAt: now() },
      )
      return true
    },

    async getDesktopTask(uid: string, taskId: string): Promise<DesktopTaskDoc | null> {
      const doc = await db.doc(desktopTaskPath(uid, taskId)).get()
      if (!doc.exists) return null
      return doc.data() as unknown as DesktopTaskDoc
    },

    async failDesktopTaskIfUnresolved(
      uid: string,
      taskId: string,
      error: DesktopTaskError,
    ): Promise<boolean> {
      const ref = db.doc(desktopTaskPath(uid, taskId))
      const snap = await ref.get()
      if (!snap.exists) return false
      const current = snap.data() as unknown as DesktopTaskDoc
      if (current.status === 'complete' || current.status === 'failed') return false
      await ref.update({ status: 'failed', error, updatedAt: now() })
      return true
    },

    watchDesktopTask(uid: string, taskId: string, cb: (task: DesktopTaskDoc) => void): () => void {
      const ref = db.doc(desktopTaskPath(uid, taskId))
      if (!ref.onSnapshot) throw new Error('watchDesktopTask requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as DesktopTaskDoc)
      })
    },

    watchPendingDesktopTasks(
      uid: string,
      deviceId: string,
      cb: (tasks: DesktopTaskDoc[]) => void,
    ): () => void {
      const q = db
        .collection(desktopTasksPath(uid))
        .where('status', '==', 'pending')
        .where('deviceId', '==', deviceId)
      if (!q.onSnapshot) throw new Error('watchPendingDesktopTasks requires onSnapshot support')
      return q.onSnapshot((docs) => {
        cb(docs.map((d) => d.data() as unknown as DesktopTaskDoc))
      })
    },

    async markDesktopDeviceOnline(
      uid: string,
      deviceId: string,
      instanceId: string,
    ): Promise<void> {
      await db.doc(`${devicesPath(uid)}/${deviceId}`).update({
        online: true,
        connectedInstanceId: instanceId,
        lastSeenAt: now(),
      })
    },

    async markDesktopDeviceOffline(
      uid: string,
      deviceId: string,
      expectedInstanceId?: string,
    ): Promise<void> {
      const ref = db.doc(`${devicesPath(uid)}/${deviceId}`)
      const snap = await ref.get()
      if (!snap.exists) return
      const data = snap.data() as { connectedInstanceId?: string | null } | undefined
      if (expectedInstanceId !== undefined && data?.connectedInstanceId !== expectedInstanceId)
        return
      await ref.update({ online: false, connectedInstanceId: null })
    },

    async touchDesktopDeviceLastSeen(uid: string, deviceId: string): Promise<void> {
      const ref = db.doc(`${devicesPath(uid)}/${deviceId}`)
      const snap = await ref.get()
      if (!snap.exists) throw new Error('DEVICE_NOT_FOUND')
      await ref.update({ lastSeenAt: now() })
    },

    async createSession(uid: string, sid: string, meta: SessionMeta): Promise<void> {
      await db.doc(sessionPath(uid, sid)).set({
        status: meta.status,
        trigger: meta.trigger,
        voiceInstanceId: meta.voiceInstanceId,
        browserInstanceId: null,
        browserConnectedAt: null,
        createdAt: now(),
        expiresAt: ttl(),
      })
    },

    async getSession(uid: string, sid: string): Promise<SessionDoc> {
      const doc = await db.doc(sessionPath(uid, sid)).get()
      if (!doc.exists) throw new Error('SESSION_NOT_FOUND')
      return doc.data() as unknown as SessionDoc
    },

    async markBrowserConnected(
      uid: string,
      sid: string,
      browserInstanceId: string,
      taskId: string,
    ): Promise<void> {
      const sessionUpdate = {
        status: 'routing',
        browserInstanceId,
        browserConnectedAt: now(),
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
        status: 'pending',
        intent,
        result: null,
        error: null,
        authRequired: intent.requiresAuth,
        haltedStepIndex: null,
        createdAt: now(),
        updatedAt: now(),
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

    async writeTaskResult(
      uid: string,
      sid: string,
      tid: string,
      result: TaskResult,
    ): Promise<void> {
      await db.doc(taskPath(uid, sid, tid)).update({
        status: result.status,
        result,
        error: result.error ?? null,
        updatedAt: now(),
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

    async haltForAuth(
      uid: string,
      sid: string,
      tid: string,
      haltedStepIndex: number,
      actionSummary: string,
      partialData?: Record<string, string>,
      partialActiveUrl?: string,
    ): Promise<void> {
      const AUTH_TTL_MS = 5 * 60 * 1000
      const authPath = `users/${uid}/sessions/${sid}/auth/${tid}`
      const expiresAt = admin.firestore?.Timestamp
        ? admin.firestore.Timestamp.fromMillis(Date.now() + AUTH_TTL_MS)
        : ((Date.now() + AUTH_TTL_MS) as unknown)
      const authDoc = {
        status: 'pending',
        actionSummary,
        expiresAt,
        approvedAt: null,
        approvalToken: null,
      }
      const taskUpdate = {
        status: 'awaiting_auth',
        haltedStepIndex,
        partialData: partialData ?? {},
        partialActiveUrl: partialActiveUrl ?? '',
        updatedAt: now(),
      }

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

    /**
     * Atomically reserve a scheduler run key before spending credit or creating tasks.
     * Returns existing session/task IDs when Cloud Scheduler retries a prior execution.
     */
    async reserveSchedulerRun(
      uid: string,
      runKey: string,
      ids: { sessionId: string; taskId: string },
    ): Promise<'reserved' | 'duplicate'> {
      const ref = db.doc(schedulerRunPath(uid, runKey))
      const payload = { sessionId: ids.sessionId, taskId: ids.taskId, createdAt: now() }
      if (ref.create) {
        try {
          await ref.create(payload)
          return 'reserved'
        } catch (err: unknown) {
          const code = (err as { code?: number | string })?.code
          if (code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS') {
            return 'duplicate'
          }
          throw err
        }
      }
      const existing = await ref.get()
      if (existing.exists) return 'duplicate'
      await ref.set(payload)
      return 'reserved'
    },

    async getSchedulerRun(
      uid: string,
      runKey: string,
    ): Promise<{ sessionId: string; taskId: string } | null> {
      const doc = await db.doc(schedulerRunPath(uid, runKey)).get()
      if (!doc.exists) return null
      const data = doc.data() as { sessionId?: string; taskId?: string }
      if (!data.sessionId || !data.taskId) return null
      return { sessionId: data.sessionId, taskId: data.taskId }
    },

    watchAuth(uid: string, sid: string, tid: string, cb: (auth: AuthDoc) => void): () => void {
      const authPath = `users/${uid}/sessions/${sid}/auth/${tid}`
      const ref = db.doc(authPath)
      if (!ref.onSnapshot) throw new Error('watchAuth requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as AuthDoc)
      })
    },
  }
}

export type FirestoreSession = ReturnType<typeof createFirestoreSession>

export function defaultFirestoreSession(): FirestoreSession {
  const raw = admin.firestore()
  const db: FirestoreLike = {
    doc: (path) => {
      const ref = raw.doc(path)
      return {
        ...(ref as FirestoreLike['doc'] extends (p: string) => infer R ? R : never),
        create: (data: Record<string, unknown>) => ref.create(data),
      }
    },
    collection: (path) => {
      const col = raw.collection(path)
      const wrap = (q: FirebaseFirestore.Query): CollectionQuery => ({
        where: (f, op, v) => wrap(q.where(f, op as FirebaseFirestore.WhereFilterOp, v)),
        orderBy: (f, dir) => wrap(q.orderBy(f, dir)),
        limit: (n) => wrap(q.limit(n)),
        get: async () => {
          const snap = await q.get()
          return {
            empty: snap.empty,
            docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })),
          }
        },
        onSnapshot: (cb) =>
          q.onSnapshot((snap) => cb(snap.docs.map((d) => ({ id: d.id, data: () => d.data() })))),
      })
      return wrap(col)
    },
    batch: () => {
      const batch = raw.batch()
      return {
        update(path: string, data: Record<string, unknown>) {
          batch.update(raw.doc(path), data)
        },
        set(path: string, data: Record<string, unknown>) {
          batch.set(raw.doc(path), data)
        },
        commit: async () => {
          await batch.commit()
        },
      }
    },
  }
  return createFirestoreSession(db)
}
