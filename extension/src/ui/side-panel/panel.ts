import { initializeApp } from 'firebase/app'
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth'
import { FIREBASE_CONFIG, CLOUD_BASE_URL, FIREBASE_SENDER_ID } from '../../env.js'

const app = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)
const $ = (id: string) => document.getElementById(id)!

onAuthStateChanged(auth, (user) => {
  ;($('account')).textContent = `Account: ${user?.email ?? '(signed out)'}`
  ;($('signin') as HTMLButtonElement).hidden = !!user
  ;($('signout') as HTMLButtonElement).hidden = !user
  if (user) void registerThisDevice()
})

$('signin').addEventListener('click', () => { void signInWithPopup(auth, new GoogleAuthProvider()) })
$('signout').addEventListener('click', () => { void signOut(auth); void chrome.storage.local.remove('deviceId') })

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
  const idToken = await auth.currentUser!.getIdToken()
  const { deviceId: existing, gcmToken } = await chrome.storage.local.get(['deviceId', 'gcmToken'])
  const deviceId = (existing as string) ?? crypto.randomUUID()
  if (!existing) await chrome.storage.local.set({ deviceId })
  let token = gcmToken as string | undefined
  if (!token) token = await new Promise<string>((res) => chrome.gcm.register([FIREBASE_SENDER_ID], (t) => res(t)))
  await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fcmToken: token, deviceId, deviceName: `${navigator.platform} — Chrome` }),
  })
  ;($('device')).textContent = `Device: ${navigator.platform} — Chrome`
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
  ;($('log')).innerHTML = (actionLog as Array<{ ts: number; action: string; status: string }>)
    .map((e) => `<li>${new Date(e.ts).toLocaleTimeString()} ${e.action} ${e.status === 'complete' ? '✓' : '✕'}</li>`).join('')
}
void renderLog()
chrome.storage.onChanged.addListener((c) => { if (c.actionLog) void renderLog() })
