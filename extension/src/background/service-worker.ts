import { FIREBASE_SENDER_ID, CLOUD_BASE_URL, CLOUD_WS_URL } from '../env.js'
import { ensureOffscreen, requestIdToken, closeOffscreen } from './auth-bridge.js'
import { createWsClient } from './ws-client.js'
import { createInjector } from './content-bridge.js'
import { dispatchTask } from './task-dispatcher.js'
import type { TaskIntent } from '../shared/dsl-types.js'

async function getDeviceId(): Promise<string> {
  const { deviceId } = await chrome.storage.local.get('deviceId')
  if (deviceId) return deviceId as string
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ deviceId: id })
  return id
}

async function upsertDeviceRegistration(idToken: string, gcmToken: string): Promise<void> {
  const deviceId = await getDeviceId()
  await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      fcmToken: gcmToken,
      deviceId,
      deviceName: `${navigator.platform} — Chrome`,
    }),
  })
}

async function registerDevice(gcmToken: string): Promise<void> {
  const idToken = await requestIdToken().catch(() => null)
  if (!idToken) return
  await upsertDeviceRegistration(idToken, gcmToken)
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.gcm.register([FIREBASE_SENDER_ID], (gcmToken) => {
    if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return }
    void chrome.storage.local.set({ gcmToken })
    void registerDevice(gcmToken)
  })
})

chrome.gcm.onMessage.addListener((message) => {
  const data = message.data as { type?: string; sessionId?: string; taskId?: string; resume?: string }
  if (data.type !== 'WAKE_AND_CONNECT' || !data.sessionId) return
  void wakeAndConnect(data.sessionId)
})

async function wakeAndConnect(sessionId: string): Promise<void> {
  const { paused } = await chrome.storage.local.get('paused')
  if (paused) return
  await ensureOffscreen()
  let idToken: string
  try { idToken = await requestIdToken() } catch (e) { console.error('No auth for wake:', e); return }
  const deviceId = await getDeviceId()
  const injector = createInjector()

  const client = createWsClient({
    url: CLOUD_WS_URL, idToken, sessionId, deviceId,
    onSessionReady: () => {
      void chrome.storage.local.get('gcmToken').then(({ gcmToken }) => {
        if (gcmToken) void upsertDeviceRegistration(idToken, gcmToken as string)
      })
    },
    onTask: (intent) => {
      void (async () => {
        const outcome = await dispatchTask(intent, injector)
        if (outcome.status === 'awaiting_auth') {
          client.sendAwaitingAuth(outcome.taskId, outcome.haltedStepIndex, outcome.partialData, outcome.partialActiveUrl)
          await appendActionLog(intent, 'awaiting_auth')
          client.close()
          void closeOffscreen()
          return
        }
        const result = outcome as import('../shared/dsl-types.js').TaskResult
        await appendActionLog(intent, result.status)
        client.sendResult(result)
      })()
    },
    onSessionEnd: () => { client.close(); void closeOffscreen() },
  })
  client.connect()
}

async function appendActionLog(intent: TaskIntent, status: string): Promise<void> {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog')
  const actionType = intent.action.type === 'sequence' ? 'sequence' : intent.action.type
  const next = [{ ts: Date.now(), action: actionType, status }, ...(actionLog as unknown[])].slice(0, 50)
  await chrome.storage.local.set({ actionLog: next })
}

chrome.action?.onClicked?.addListener?.(() => { void chrome.sidePanel.open({ windowId: chrome.windows?.WINDOW_ID_CURRENT }) })

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'host-permission') {
    void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
  }
})
