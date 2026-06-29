import admin from 'firebase-admin'

export interface MessagingLike {
  send(message: { token: string; data: Record<string, string> }): Promise<string>
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export function createFcmDispatcher(messaging: MessagingLike, fetchImpl: typeof fetch = fetch) {
  async function expoPush(payload: Record<string, unknown>): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Expo Push failed: ${res.status}`)
      const body = await res.json() as {
        errors?: unknown[]
        data?: Array<{ status: string; message?: string; details?: unknown }> | { status: string; message?: string; details?: unknown }
      }
      if (body.errors?.length) {
        throw new Error(`Expo Push request error: ${JSON.stringify(body.errors)}`)
      }
      const tickets = Array.isArray(body.data) ? body.data : body.data ? [body.data] : []
      const ticketError = tickets.find((t) => t.status === 'error')
      if (ticketError) {
        throw new Error(`Expo Push ticket error: ${ticketError.message ?? JSON.stringify(ticketError.details)}`)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async wakeExtension(fcmToken: string, sessionId: string, taskId: string, resume = false): Promise<void> {
      await messaging.send({
        token: fcmToken,
        data: { type: 'WAKE_AND_CONNECT', sessionId, taskId, resume: String(resume) },
      })
    },

    async sendApprovalCard(expoPushToken: string, sessionId: string, taskId: string, actionSummary: string): Promise<void> {
      await expoPush({
        to: expoPushToken,
        title: 'Clanker needs your approval',
        body: actionSummary,
        data: { type: 'PENDING_AUTH', sessionId, taskId, actionSummary },
        categoryIdentifier: 'BROWSER_ACTION_APPROVAL',
        priority: 'high',
        ttl: 300,
      })
    },

    async sendTaskComplete(expoPushToken: string, sessionId: string, taskId: string, summary: string): Promise<void> {
      await expoPush({
        to: expoPushToken,
        title: 'Clanker finished',
        body: summary,
        data: { type: 'TASK_COMPLETE', sessionId, taskId, deepLink: '/talk' },
        priority: 'normal',
      })
    },

    async sendProactive(expoPushToken: string, sessionId: string, taskId: string, body: string): Promise<void> {
      await expoPush({
        to: expoPushToken,
        title: 'Clanker noticed something',
        body,
        data: { type: 'PROACTIVE_TASK', sessionId, taskId, deepLink: '/talk' },
        categoryIdentifier: 'BROWSER_ACTION_APPROVAL',
        priority: 'high',
      })
    },
  }
}

export type FcmDispatcher = ReturnType<typeof createFcmDispatcher>

export function defaultFcmDispatcher(): FcmDispatcher {
  return createFcmDispatcher(admin.messaging() as unknown as MessagingLike)
}
