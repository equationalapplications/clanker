import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth/web-extension'
import { FIREBASE_CONFIG, CLOUD_BASE_URL, FIREBASE_SENDER_ID } from '../../env.js'
import { renderLogEntries } from './render-log.js'

const app = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)
const $ = (id: string) => document.getElementById(id)!

onAuthStateChanged(auth, (user) => {
  ;($('account')).textContent = `Account: ${user?.email ?? '(signed out)'}`
  ;($('signin-form') as HTMLDivElement).hidden = !!user
  ;($('signout') as HTMLButtonElement).hidden = !user
  ;($('retry-register') as HTMLButtonElement).hidden = !user
  if (user) void registerThisDevice()
})

$('signin').addEventListener('click', () => {
  const email = ($('email') as HTMLInputElement).value.trim()
  const password = ($('password') as HTMLInputElement).value
  void signInWithEmailAndPassword(auth, email, password).catch((e) => alert(e.message))
})
$('signout').addEventListener('click', () => { void signOut(auth); void chrome.storage.local.remove('deviceId') })
$('retry-register').addEventListener('click', () => { void registerThisDevice() })

$('pause').addEventListener('click', async () => {
  const { paused } = await chrome.storage.local.get('paused')
  const next = !paused
  await chrome.storage.local.set({ paused: next })
  ;($('pause')).textContent = next ? 'Resume Remote Actions' : 'Pause Remote Actions'
  await syncPauseToCloud(next)
})

$('grant').addEventListener('click', async () => {
  const { pendingHost, pendingOrigin } = await chrome.storage.local.get(['pendingHost', 'pendingOrigin'])
  if (!pendingHost) return
  const origin = (pendingOrigin as string | undefined) ?? `https://${pendingHost}/*`
  const granted = await chrome.permissions.request({ origins: [origin] })
  if (granted) await chrome.storage.local.remove(['pendingHost', 'pendingOrigin'])
  void syncGrantButton()
})

async function syncGrantButton(): Promise<void> {
  const { pendingHost } = await chrome.storage.local.get('pendingHost')
  const grant = $('grant') as HTMLButtonElement
  grant.hidden = !pendingHost
  if (pendingHost) grant.textContent = `Grant Access to ${pendingHost}`
}
void syncGrantButton()
chrome.storage.onChanged.addListener((c) => { if (c.pendingHost) void syncGrantButton() })

async function registerThisDevice(): Promise<void> {
  const user = auth.currentUser
  if (!user) return
  ;($('device')).textContent = 'Device: registering...'
  try {
    const idToken = await user.getIdToken()
    const { deviceId: existing, gcmToken: cached } = await chrome.storage.local.get(['deviceId', 'gcmToken'])
    const deviceId = (existing as string) ?? crypto.randomUUID()
    if (!existing) await chrome.storage.local.set({ deviceId })
    // Register immediately with cached GCM token or polling placeholder.
    // This avoids holding the auth token while waiting for slow GCM negotiation.
    const fcmToken = (cached as string | undefined) ?? `polling:${deviceId}`
    const res = await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ fcmToken, deviceId, deviceName: `${navigator.platform} — Chrome` }),
    })
    if (!res.ok) { ;($('device')).textContent = `Device: registration failed (${res.status})`; return }
    const mode = cached ? '' : ' (polling mode — GCM unavailable)'
    ;($('device')).textContent = `Device: ${navigator.platform} — Chrome (registered${mode})`
  } catch {
    ;($('device')).textContent = 'Device: registration failed'
  }
}

async function syncPauseToCloud(isPaused: boolean): Promise<void> {
  const user = auth.currentUser; if (!user) return
  const idToken = await user.getIdToken()
  const { deviceId, gcmToken } = await chrome.storage.local.get(['deviceId', 'gcmToken'])
  await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fcmToken: gcmToken, deviceId, deviceName: `${navigator.platform} — Chrome`, isPaused }),
  })
}

async function renderLog(): Promise<void> {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog')
  renderLogEntries($('log'), actionLog as Array<{ ts: number; action: string; status: string }>)
}
void renderLog()
chrome.storage.onChanged.addListener((c) => { if (c.actionLog) void renderLog() })
