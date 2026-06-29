import admin from 'firebase-admin'

// FCM data messages require all values to be strings.
export interface MessagingLike {
  send(message: { token: string; data: Record<string, string> }): Promise<string>
}

export function createFcmDispatcher(messaging: MessagingLike) {
  return {
    async wakeExtension(fcmToken: string, sessionId: string, taskId: string, resume = false): Promise<void> {
      await messaging.send({
        token: fcmToken,
        data: { type: 'WAKE_AND_CONNECT', sessionId, taskId, resume: String(resume) },
      })
    },
  }
}

export type FcmDispatcher = ReturnType<typeof createFcmDispatcher>

export function defaultFcmDispatcher(): FcmDispatcher {
  return createFcmDispatcher(admin.messaging() as unknown as MessagingLike)
}
